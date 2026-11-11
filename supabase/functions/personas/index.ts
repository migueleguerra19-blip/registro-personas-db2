import { withSupabase } from "npm:@supabase/server@^1";
import { argon2id } from "npm:@noble/hashes@2.4.0/argon2.js";
import { randomBytes } from "npm:@noble/hashes@2.4.0/utils.js";

const safeColumns = "id,identificacion,tipo_identificacion,nombres,apellidos,correo_electronico,telefono,direccion,username,foto,foto_mime,creado_en,actualizado_en";
const documentTypes = new Set(["11", "12", "13", "22", "31", "41"]);
const encoder = new TextEncoder();

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const digest = argon2id(encoder.encode(password), salt, { m: 65536, t: 3, p: 1, dkLen: 32 });
  const saltText = base64(salt).replace(/=+$/, "");
  const digestText = base64(digest).replace(/=+$/, "");
  return `$argon2id$v=19$m=65536,t=3,p=1$${saltText}$${digestText}`;
}

function normalizePerson(value: Record<string, unknown>) {
  const person = {
    tipo_identificacion: clean(value.tipo_identificacion, 2),
    identificacion: clean(value.identificacion, 20),
    nombres: clean(value.nombres, 80),
    apellidos: clean(value.apellidos, 80),
    correo_electronico: clean(value.correo_electronico, 254).toLowerCase(),
    telefono: clean(value.telefono, 30),
    direccion: clean(value.direccion, 180),
    username: clean(value.username, 40).toLowerCase(),
    password: String(value.password ?? ""),
    foto: value.foto === null || value.foto === undefined ? null : String(value.foto),
    foto_mime: value.foto_mime === null || value.foto_mime === undefined ? null : clean(value.foto_mime, 30),
  };
  if (!documentTypes.has(person.tipo_identificacion)) throw new Error("El tipo de identificación seleccionado no es válido.");
  if (!person.identificacion || !person.nombres || !person.apellidos || !person.correo_electronico || !person.username) throw new Error("Completa los campos obligatorios.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.correo_electronico)) throw new Error("Escribe un correo electrónico válido.");
  if (!/^[a-z0-9._-]+$/.test(person.username)) throw new Error("El nombre de usuario solo puede incluir letras sin tilde, números, puntos, guiones y guiones bajos.");
  if (person.foto !== null && (!/^\\x(?:[0-9a-f]{2})+$/i.test(person.foto) || person.foto.length > 4_194_306)) throw new Error("La fotografía debe ser un archivo PNG o JPG de máximo 2 MB.");
  if (person.foto_mime !== null && !["image/png", "image/jpeg"].includes(person.foto_mime)) throw new Error("El formato de la fotografía debe ser PNG o JPG.");
  return person;
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    try {
      if (request.method !== "POST") return response({ error: "Método no permitido." }, 405);
      const userId = String(context.userClaims.sub);
      const admin = context.supabaseAdmin;
      const body = await request.json();
      const action = String(body.action ?? "");

      if (action === "list") {
        const { data, error } = await admin.from("personas").select(safeColumns).eq("auth_user_id", userId).order("creado_en", { ascending: false });
        if (error) throw error;
        return response({ records: data ?? [] });
      }

      if (action === "create") {
        const person = normalizePerson(body.person ?? {});
        if (person.password.length < 8 || person.password.length > 128) throw new Error("La contraseña debe tener entre 8 y 128 caracteres.");
        const passwordHash = await hashPassword(person.password);
        const { password, ...fields } = person;
        const { data, error } = await admin.from("personas").insert({ ...fields, auth_user_id: userId, password_hash: passwordHash }).select(safeColumns).single();
        if (error) throw error;
        return response({ record: data }, 201);
      }

      if (action === "update") {
        const id = String(body.id ?? "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("El ID del registro no es válido.");
        const person = normalizePerson(body.person ?? {});
        const { data: existing, error: lookupError } = await admin.from("personas").select("id").eq("id", id).eq("auth_user_id", userId).maybeSingle();
        if (lookupError) throw lookupError;
        if (!existing) return response({ error: "No se encontró la persona solicitada." }, 404);
        const { password, ...fields } = person;
        const updates: Record<string, unknown> = { ...fields };
        if (password) {
          if (password.length < 8 || password.length > 128) throw new Error("La contraseña debe tener entre 8 y 128 caracteres.");
          updates.password_hash = await hashPassword(password);
        }
        const { data, error } = await admin.from("personas").update(updates).eq("id", id).eq("auth_user_id", userId).select(safeColumns).single();
        if (error) throw error;
        return response({ record: data });
      }

      if (action === "delete") {
        const id = String(body.id ?? "");
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("El ID del registro no es válido.");
        const { data, error } = await admin.from("personas").delete().eq("id", id).eq("auth_user_id", userId).select("id").maybeSingle();
        if (error) throw error;
        if (!data) return response({ error: "No se encontró la persona solicitada." }, 404);
        return response({ ok: true });
      }

      return response({ error: "Acción no reconocida." }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado en la API.";
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      const friendly = code === "23505" ? "La identificación, el correo o el nombre de usuario ya existe." : message;
      return response({ error: friendly }, code === "23505" ? 409 : 400);
    }
  }),
};

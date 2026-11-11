const $ = (selector) => document.querySelector(selector);
const configKey = "db2-supabase-config-v1";
const localDataKey = "db2-personas-demo-v1";
const maxPhotoBytes = 2 * 1024 * 1024;
const documentNames = { "11": "Registro civil", "12": "Tarjeta de identidad", "13": "Cédula de ciudadanía", "22": "Cédula de extranjería", "31": "NIT", "41": "Pasaporte" };
const state = { client: null, session: null, records: [], photoDataUrl: "", query: "", editingId: null, toastTimer: null };

function readStoredConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(configKey) || "{}");
    if (stored.disabled) return { url: "", anonKey: "" };
    return { ...(window.APP_CONFIG ?? {}), ...stored };
  }
  catch { return { ...(window.APP_CONFIG ?? {}) }; }
}

function storedRecords() {
  try { const value = JSON.parse(localStorage.getItem(localDataKey) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function clean(value = "") { return String(value).trim().replace(/\s+/g, " "); }

function slug(value = "") {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function suggestUsername() {
  const firstName = clean($("#nombres").value).split(" ")[0] || "";
  const firstSurname = clean($("#apellidos").value).split(" ")[0] || "";
  const suggestion = [slug(firstName), slug(firstSurname)].filter(Boolean).join(".");
  if ($("#username").dataset.edited !== "true") $("#username").value = suggestion;
}

function setMode(connected) {
  const badge = $("#modeBadge");
  badge.classList.toggle("connected", connected);
  badge.innerHTML = connected ? "<span></span> Supabase" : "<span></span> Modo local";
  $("#connectionNotice").classList.toggle("is-hidden", connected);
  $("#authButton").classList.toggle("is-hidden", !state.client);
  if (state.client) $("#authButton").textContent = state.session ? "Cerrar sesión" : "Iniciar sesión";
}

function setPasswordCopy() {
  const input = $("#personPassword");
  const requiredMark = document.querySelector(".password-required");
  const hint = $("#passwordHint");
  input.required = Boolean(state.session && !state.editingId);
  if (requiredMark) requiredMark.classList.toggle("is-hidden", !input.required);
  if (hint) hint.textContent = state.client
    ? "La API la guarda con hash Argon2id. Nunca se muestra al consultar."
    : "En modo local no se guarda; conecta Supabase para aplicar Argon2id.";
}

function setAuthState(session) {
  state.session = session;
  setMode(Boolean(state.client));
  $("#newPersonButton").disabled = Boolean(state.client && !session);
  $("#newPersonButton").title = state.client && !session ? "Inicia sesión para gestionar registros" : "Crear una persona";
  if (!session && state.client) state.records = [];
  setPasswordCopy();
  render();
}

async function connectClient() {
  const config = readStoredConfig();
  const url = String(config.url || "").trim().replace(/\/$/, "");
  const anonKey = String(config.anonKey || "").trim();
  if (!url || !anonKey || !window.supabase?.createClient) {
    state.client = null;
    state.session = null;
    state.records = storedRecords();
    setAuthState(null);
    return;
  }
  state.client = window.supabase.createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const { data, error } = await state.client.auth.getSession();
  if (error) throw error;
  state.session = data.session;
  state.client.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    if (!session) state.records = [];
    setAuthState(session);
    if (session) void loadRecords();
  });
  setAuthState(data.session);
  if (data.session) await loadRecords();
}

async function callApi(action, payload = {}) {
  if (!state.client || !state.session) throw new Error("Conecta Supabase e inicia sesión para usar la base de datos.");
  const { data, error } = await state.client.functions.invoke("personas", { body: { action, ...payload } });
  if (error) {
    const details = error.context?.json?.error || error.message;
    throw new Error(details || "No fue posible comunicarse con la API.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadRecords() {
  if (!state.client || !state.session) return;
  try {
    const result = await callApi("list");
    state.records = Array.isArray(result.records) ? result.records : [];
    render();
  } catch (error) {
    notify(error.message || "No se pudieron consultar los registros.", true);
  }
}

function formatPersonName(person) { return [clean(person.nombres), clean(person.apellidos)].filter(Boolean).join(" "); }

function avatarMarkup(person) {
  const image = person.foto_data_url || byteaToDataUrl(person.foto, person.foto_mime);
  if (image) return `<span class="avatar"><img src="${escapeHtml(image)}" alt="" /></span>`;
  const initials = `${clean(person.nombres)[0] || ""}${clean(person.apellidos)[0] || ""}`.toUpperCase() || "?";
  return `<span class="avatar">${escapeHtml(initials)}</span>`;
}

function filteredRecords() {
  const query = state.query.toLocaleLowerCase("es");
  if (!query) return state.records;
  return state.records.filter((person) => [person.nombres, person.apellidos, person.identificacion, person.correo_electronico, person.username, person.telefono].some((value) => String(value || "").toLocaleLowerCase("es").includes(query)));
}

function render() {
  const tbody = $("#peopleRows");
  const list = filteredRecords();
  const types = new Set(state.records.map((record) => record.tipo_identificacion).filter(Boolean));
  $("#totalStat").textContent = String(state.records.length);
  $("#emailStat").textContent = String(state.records.filter((record) => record.correo_electronico).length);
  $("#typeStat").textContent = String(types.size);
  $("#resultCount").textContent = `${list.length} ${list.length === 1 ? "persona" : "personas"}`;
  const rows = list.map((person) => {
    const name = formatPersonName(person) || "Sin nombre";
    const type = documentNames[String(person.tipo_identificacion)] || "Documento";
    return `<tr>
      <td><div class="person-cell">${avatarMarkup(person)}<span class="person-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(person.telefono || "Sin teléfono")}</small></span></div></td>
      <td><span class="doc-pill">${escapeHtml(type)}</span><div class="secondary-text">${escapeHtml(person.identificacion || "")}</div></td>
      <td>${escapeHtml(person.correo_electronico || "—")}</td>
      <td>@${escapeHtml(person.username || "")}</td>
      <td><div class="row-actions"><button class="row-action" type="button" data-action="edit" data-id="${escapeHtml(person.id)}" aria-label="Editar ${escapeHtml(name)}" title="Editar">✎</button><button class="row-action delete" type="button" data-action="delete" data-id="${escapeHtml(person.id)}" aria-label="Eliminar ${escapeHtml(name)}" title="Eliminar">⌫</button></div></td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rows;
  const empty = $("#emptyState");
  empty.classList.toggle("is-hidden", list.length > 0);
  $("#emptyTitle").textContent = state.query ? "No encontramos coincidencias" : (state.client && !state.session ? "Inicia sesión para ver el directorio" : "Aún no hay personas");
  $("#emptyCopy").textContent = state.query ? "Prueba con otro nombre, documento, correo o usuario." : (state.client && !state.session ? "Accede con tu cuenta para consultar o administrar los registros." : "Agrega un registro para comenzar a organizar tu directorio.");
  empty.querySelector("[data-open-form]").classList.toggle("is-hidden", Boolean(state.query) || Boolean(state.client && !state.session));
  $("#newPersonButton").classList.toggle("is-hidden", Boolean(state.client && !state.session));
}

function openPersonForm(person = null) {
  if (state.client && !state.session) { openDialog("authDialog"); return; }
  const form = $("#personForm");
  form.reset();
  state.editingId = person?.id || null;
  state.photoDataUrl = person?.foto_data_url || (person ? byteaToDataUrl(person.foto, person.foto_mime) : "") || "";
  $("#personDialogTitle").textContent = person ? "Editar persona" : "Nueva persona";
  $("#savePersonButton").textContent = person ? "Guardar cambios" : "Guardar persona";
  $("#personId").value = person?.id || "";
  $("#idField").hidden = !person;
  $("#idValue").textContent = person?.id || "";
  $("#documentType").value = person?.tipo_identificacion || "";
  $("#identificacion").value = person?.identificacion || "";
  $("#nombres").value = person?.nombres || "";
  $("#apellidos").value = person?.apellidos || "";
  $("#correo").value = person?.correo_electronico || "";
  $("#telefono").value = person?.telefono || "";
  $("#direccion").value = person?.direccion || "";
  $("#username").value = person?.username || "";
  $("#username").dataset.edited = person ? "true" : "false";
  $("#personPassword").value = "";
  $("#foto").value = "";
  setPhotoPreview(state.photoDataUrl);
  setPasswordCopy();
  setFormError("");
  openDialog("personDialog");
}

function openDialog(id) { const dialog = document.getElementById(id); if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { const dialog = document.getElementById(id); if (dialog.open) dialog.close(); }

function setFormError(message) {
  const error = $("#formError");
  error.textContent = message;
  error.hidden = !message;
}

function setPhotoPreview(dataUrl = "") {
  $("#photoPreview").innerHTML = dataUrl ? `<img src="${escapeHtml(dataUrl)}" alt="Vista previa de la fotografía" />` : "+";
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) return { foto: null, foto_mime: null };
  const binary = atob(match[2]);
  let hex = "\\x";
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  return { foto: hex, foto_mime: match[1] };
}

function byteaToDataUrl(value, mime = "image/jpeg") {
  if (!value) return "";
  if (String(value).startsWith("data:image/")) return value;
  const hex = String(value).replace(/^\\x/, "");
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex) || !hex) return "";
  let binary = "";
  for (let i = 0; i < hex.length; i += 8192) {
    const slice = hex.slice(i, i + 8192);
    let chunk = "";
    for (let j = 0; j < slice.length; j += 2) chunk += String.fromCharCode(parseInt(slice.slice(j, j + 2), 16));
    binary += chunk;
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function normalizedForm() {
  return {
    tipo_identificacion: $("#documentType").value,
    identificacion: clean($("#identificacion").value),
    nombres: clean($("#nombres").value),
    apellidos: clean($("#apellidos").value),
    correo_electronico: clean($("#correo").value).toLocaleLowerCase("es"),
    telefono: clean($("#telefono").value),
    direccion: clean($("#direccion").value),
    username: clean($("#username").value).toLocaleLowerCase("es"),
    password: $("#personPassword").value,
    ...dataUrlToBytes(state.photoDataUrl),
  };
}

function validateForm(person) {
  if (!person.tipo_identificacion || !person.identificacion || !person.nombres || !person.apellidos || !person.correo_electronico || !person.username) return "Completa todos los campos obligatorios.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.correo_electronico)) return "Escribe un correo electrónico válido.";
  if (person.identificacion.length > 20) return "La identificación no puede superar 20 caracteres.";
  if (state.client && !state.editingId && person.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (state.client && person.password && person.password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  const duplicate = state.records.find((row) => row.id !== state.editingId && (
    String(row.identificacion).toLocaleLowerCase("es") === person.identificacion.toLocaleLowerCase("es") ||
    String(row.correo_electronico).toLocaleLowerCase("es") === person.correo_electronico ||
    String(row.username).toLocaleLowerCase("es") === person.username
  ));
  return duplicate ? "La identificación, el correo y el nombre de usuario deben ser únicos." : "";
}

async function savePerson(event) {
  event.preventDefault();
  setFormError("");
  const person = normalizedForm();
  const validationError = validateForm(person);
  if (validationError) { setFormError(validationError); return; }
  const saveButton = $("#savePersonButton");
  saveButton.disabled = true;
  saveButton.textContent = "Guardando…";
  try {
    if (state.client) {
      const result = await callApi(state.editingId ? "update" : "create", { id: state.editingId, person });
      if (result.record) {
        state.records = state.editingId
          ? state.records.map((row) => row.id === state.editingId ? result.record : row)
          : [result.record, ...state.records];
      }
      await loadRecords();
    } else {
      const editing = state.records.find((row) => row.id === state.editingId);
      const record = { ...person, password: undefined, id: state.editingId || crypto.randomUUID(), created_at: editing?.created_at || new Date().toISOString() };
      state.records = state.editingId ? state.records.map((row) => row.id === state.editingId ? record : row) : [record, ...state.records];
      localStorage.setItem(localDataKey, JSON.stringify(state.records));
    }
    closeDialog("personDialog");
    render();
    notify(state.client ? "Registro guardado en PostgreSQL." : "Registro guardado en este navegador. La contraseña no se guardó.");
  } catch (error) {
    setFormError(error.message || "No fue posible guardar el registro.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = state.editingId ? "Guardar cambios" : "Guardar persona";
  }
}

async function deletePerson(id) {
  const person = state.records.find((row) => row.id === id);
  if (!person) return;
  const name = formatPersonName(person) || person.identificacion;
  if (!window.confirm(`¿Eliminar el registro de ${name}?`)) return;
  try {
    if (state.client) await callApi("delete", { id });
    else {
      state.records = state.records.filter((row) => row.id !== id);
      localStorage.setItem(localDataKey, JSON.stringify(state.records));
    }
    state.records = state.records.filter((row) => row.id !== id);
    render();
    notify("Persona eliminada.");
  } catch (error) { notify(error.message || "No fue posible eliminar el registro.", true); }
}

function notify(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3300);
}

function openSettings() {
  const config = readStoredConfig();
  $("#supabaseUrl").value = config.url || "";
  $("#supabaseAnonKey").value = config.anonKey || "";
  $("#settingsError").hidden = true;
  openDialog("settingsDialog");
}

async function saveSettings(event) {
  event.preventDefault();
  const url = $("#supabaseUrl").value.trim().replace(/\/$/, "");
  const anonKey = $("#supabaseAnonKey").value.trim();
  const errorNode = $("#settingsError");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || anonKey.length < 20) {
    errorNode.textContent = "Revisa la URL y la clave pública anon del proyecto Supabase.";
    errorNode.hidden = false;
    return;
  }
  localStorage.setItem(configKey, JSON.stringify({ url, anonKey }));
  try {
    await connectClient();
    if (!state.client) throw new Error("No se pudo cargar Supabase. Revisa tu conexión a internet e inténtalo de nuevo.");
    closeDialog("settingsDialog");
    notify("Conexión configurada. Inicia sesión para abrir el directorio.");
  } catch (error) {
    errorNode.textContent = error.message || "No se pudo conectar con Supabase.";
    errorNode.hidden = false;
  }
}

function openAuth() {
  if (!state.client) { openSettings(); return; }
  if (state.session) {
    void state.client.auth.signOut().then(({ error }) => error ? notify(error.message, true) : notify("Sesión cerrada."));
    return;
  }
  $("#authError").hidden = true;
  openDialog("authDialog");
}

async function signIn(event) {
  event.preventDefault();
  const errorNode = $("#authError");
  const { error } = await state.client.auth.signInWithPassword({ email: $("#authEmail").value.trim(), password: $("#authPassword").value });
  if (error) { errorNode.textContent = error.message; errorNode.hidden = false; return; }
  closeDialog("authDialog");
  notify("Sesión iniciada.");
  await loadRecords();
}

async function signUp() {
  const errorNode = $("#authError");
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  if (!email || password.length < 8) { errorNode.textContent = "Escribe un correo válido y una contraseña de al menos 8 caracteres."; errorNode.hidden = false; return; }
  const emailRedirectTo = new URL("./", window.location.href).href;
  const { data, error } = await state.client.auth.signUp({ email, password, options: { emailRedirectTo } });
  if (error) { errorNode.textContent = error.message; errorNode.hidden = false; return; }
  if (data.session) { closeDialog("authDialog"); notify("Cuenta creada y sesión iniciada."); }
  else { errorNode.textContent = "Cuenta creada. Revisa tu correo para confirmar y luego inicia sesión."; errorNode.hidden = false; }
}

function wireEvents() {
  $("#newPersonButton").addEventListener("click", () => openPersonForm());
  $("#noticeConfigButton").addEventListener("click", openSettings);
  $("#settingsButton").addEventListener("click", openSettings);
  $("#authButton").addEventListener("click", openAuth);
  $("#personForm").addEventListener("submit", savePerson);
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#authForm").addEventListener("submit", signIn);
  $("#signUpButton").addEventListener("click", signUp);
  $("#disconnectButton").addEventListener("click", async () => {
    if (state.client && state.session) await state.client.auth.signOut();
    localStorage.setItem(configKey, JSON.stringify({ disabled: true }));
    state.client = null;
    state.session = null;
    state.records = storedRecords();
    closeDialog("settingsDialog");
    setAuthState(null);
    notify("Modo local activado.");
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.dataset.close)));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  document.querySelectorAll("[data-open-form]").forEach((button) => button.addEventListener("click", () => openPersonForm()));
  $("#peopleRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const record = state.records.find((person) => person.id === button.dataset.id);
    if (button.dataset.action === "edit") openPersonForm(record);
    if (button.dataset.action === "delete") void deletePerson(button.dataset.id);
  });
  $("#searchInput").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
  ["#nombres", "#apellidos"].forEach((selector) => $(selector).addEventListener("input", suggestUsername));
  $("#username").addEventListener("input", (event) => { event.currentTarget.dataset.edited = "true"; });
  $("#foto").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > maxPhotoBytes) {
      event.target.value = "";
      setFormError("Selecciona una imagen PNG o JPG de máximo 2 MB.");
      return;
    }
    state.photoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setPhotoPreview(state.photoDataUrl);
    setFormError("");
  });
}

async function init() {
  wireEvents();
  state.records = storedRecords();
  render();
  setPasswordCopy();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    void navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  try { await connectClient(); }
  catch (error) { notify(error.message || "No se pudo iniciar la conexión.", true); }
}

void init();

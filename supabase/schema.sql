-- Base de Datos II · CRUD de personas
-- Ejecutar en Supabase SQL Editor antes de desplegar la función personas.

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  identificacion varchar(20) not null,
  tipo_identificacion char(2) not null check (tipo_identificacion in ('11', '12', '13', '22', '31', '41')),
  nombres varchar(80) not null,
  apellidos varchar(80) not null,
  correo_electronico varchar(254) not null,
  telefono varchar(30),
  direccion varchar(180),
  password_hash text not null,
  username varchar(40) not null,
  foto bytea,
  foto_mime varchar(30),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint personas_identificacion_uk unique (identificacion),
  constraint personas_username_uk unique (username),
  constraint personas_correo_formato check (correo_electronico = lower(correo_electronico))
);

create unique index if not exists personas_correo_uk on public.personas (lower(correo_electronico));
create index if not exists personas_auth_user_idx on public.personas (auth_user_id);

alter table public.personas enable row level security;

drop policy if exists "Cada usuario administra sus personas" on public.personas;
create policy "Cada usuario administra sus personas"
  on public.personas
  for all
  to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

-- Solo la Edge Function usa la llave service_role; la página pública no consulta la tabla directamente.
revoke all on table public.personas from anon, authenticated;
grant all on table public.personas to service_role;

comment on table public.personas is 'Registros de personas de la tarea de Base de Datos II.';
comment on column public.personas.identificacion is 'Número de identificación único.';
comment on column public.personas.tipo_identificacion is 'Código DANE: 11 RC, 12 TI, 13 CC, 22 CE, 31 NIT, 41 PA.';
comment on column public.personas.password_hash is 'Hash Argon2id generado en el servidor; nunca se devuelve por la API.';
comment on column public.personas.foto is 'Fotografía binaria (BLOB/bytea).';
comment on column public.personas.username is 'Nombre de usuario único propuesto a partir de nombres y apellidos.';

create or replace function public.actualizar_persona_fecha()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$;

drop trigger if exists personas_actualizado_en on public.personas;
create trigger personas_actualizado_en
  before update on public.personas
  for each row execute function public.actualizar_persona_fecha();

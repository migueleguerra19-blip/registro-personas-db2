# Registro de personas · Base de Datos II

Trabajo académico de **Miguel Toro**, estudiante de Ingeniería Informática, semestre 4, jornada diurna. **Docente: Hermes Acevedo.** Su propósito es desarrollar el CRUD solicitado en el tablero de la asignatura.

- Repositorio propuesto: `registro-personas-db2`
- Cuenta GitHub indicada por el estudiante: [@migueleguerra19-blip](https://github.com/migueleguerra19-blip)
- Contacto: [migueleguerra@gmail.com](mailto:migueleguerra@gmail.com).
- Hosting web: GitHub Pages, gratuito.
- Dirección prevista: `https://migueleguerra19-blip.github.io/registro-personas-db2/` (queda activa cuando se publique el repositorio y Pages termine el primer despliegue).
- Dominio: el subdominio `github.io` no requiere compra ni configuración DNS manual. Un dominio propio necesitaría registrar el nombre y apuntar DNS a GitHub Pages.
- Base de datos: PostgreSQL gestionado por Supabase; el plan gratuito sirve para un proyecto académico pequeño. Consulta límites y disponibilidad vigentes en [Supabase Pricing](https://supabase.com/pricing).

## Funciones del tablero

- CRUD de personas con ID UUID generado por PostgreSQL.
- Tipo de identificación basado en códigos DANE: RC (11), TI (12), CC (13), CE (22), NIT (31) y pasaporte (41).
- Identificación, correo electrónico y username únicos; nombres y apellidos obligatorios.
- Teléfono, dirección, username derivado de nombres y apellidos, y fotografía guardada como `bytea` (BLOB).
- El campo contraseña se procesa en una Supabase Edge Function con Argon2id. El hash nunca se devuelve al navegador.
- Inicio de sesión de mantenimiento con Supabase Auth; cada persona solo administra sus propios registros.
- Búsqueda y resumen por cantidad de personas, correos y tipos de documento.
- Interfaz web adaptable e instalable como PWA desde navegadores móviles; comparte la API para una futura app nativa.
- Modo local para revisar la interfaz y el CRUD sin crear un proyecto Supabase. Los registros de ese modo quedan en el almacenamiento del navegador; la contraseña no se guarda.

## Estructura

```text
index.html                         Frontend estático
styles.css                         Estilos responsivos
app.js                             CRUD, conexión, búsqueda y validaciones
supabase/schema.sql                Tabla, índices, RLS y trigger
supabase/functions/personas/      API CRUD y hash Argon2id
.github/workflows/pages.yml       Publicación automática en GitHub Pages
manifest.webmanifest              Instalación como PWA en móvil
sw.js                             Caché de la interfaz
```

## Conectar PostgreSQL y API

1. Crea un proyecto PostgreSQL en [Supabase](https://supabase.com/) y copia la URL y la clave pública `anon` del proyecto.
2. Ejecuta `supabase/schema.sql` en el SQL Editor de Supabase.
3. En Windows, instala Node.js LTS si todavía no tienes `npm` (`winget install --id OpenJS.NodeJS.LTS --exact --source winget`) y vuelve a abrir PowerShell. Desde esta carpeta instala la CLI:

   ```powershell
   npm install --save-dev supabase
   ```

4. Crea un token personal de Supabase limitado a este proyecto con **Edge Functions → Read-write**. Autentica la CLI con el token sin incluirlo en el repositorio. No hace falta enlazar el proyecto local: despliega directamente al ref del proyecto.

   ```powershell
   npx supabase functions deploy personas --remote=TU_PROJECT_REF
   ```

   Revisa el proyecto de destino antes de confirmar el despliegue. La función protegida usa el cliente de servidor de Supabase; su llave de servidor permanece en el entorno protegido y nunca se publica en Pages, GitHub ni `config.js`.
5. Habilita Supabase Auth para correo y contraseña. En **Authentication → URL Configuration**, agrega la URL del sitio Pages (`https://migueleguerra19-blip.github.io/registro-personas-db2/`) a las URL de redirección. La página permite crear la cuenta que será propietaria de sus registros.
6. Abre **Conexión** en la página e ingresa URL y clave `anon`. La clave `anon` es pública; los registros se limitan en la API y en la base de datos mediante RLS.

El formulario de contraseña de cada persona se envía por HTTPS a la función `personas`; allí se genera un hash Argon2id con sal aleatoria y parámetros `m=65536,t=3,p=1`. El endpoint comprueba el usuario autenticado y filtra toda operación por su ID. La tabla no concede acceso directo a `anon` ni a `authenticated`.

## Publicar en GitHub Pages

1. Crea un repositorio público llamado `registro-personas-db2` en la cuenta `migueleguerra19-blip` y sube el contenido de esta carpeta a la rama `main`.
2. En **Settings → Pages**, selecciona **GitHub Actions** como fuente.
3. Para conectar automáticamente el sitio publicado, agrega las variables de repositorio `SUPABASE_URL` y `SUPABASE_ANON_KEY` en **Settings → Secrets and variables → Actions → Variables**. Son la URL del proyecto y la clave pública `anon`; no agregues la llave `service_role` ahí.
4. El workflow `.github/workflows/pages.yml` publicará el sitio en `https://migueleguerra19-blip.github.io/registro-personas-db2/` después de cada cambio en `main`.

GitHub Pages ofrece hosting gratuito desde repositorios públicos con GitHub Free. El sitio publicado es público, pero la base de datos requiere inicio de sesión y los registros están limitados a la cuenta autenticada.

## Ejecutar localmente

GitHub Pages y la vista previa local no incluyen servidor. Para abrir el sitio con un servidor local sencillo, ejecuta Python desde esta carpeta:

```powershell
python -m http.server 8000
```

Luego visita `http://localhost:8000`. Si no configuras Supabase, prueba el modo local; esos datos solo existen en el navegador donde se guardaron.

# Migración de Supabase a Turso

La app pasó de hablar **directo** con Supabase desde el navegador a usar una
**función serverless en Vercel** (`/api/data`) que habla con **Turso** (libSQL).
El token de Turso queda en variables de entorno y nunca llega al navegador.

```
Navegador (index.html)  ──►  /api/data (Vercel Functions)  ──►  Turso (libSQL)
```

## Estructura nueva

| Archivo | Qué hace |
|---------|----------|
| `api/data.js` | Función serverless: `GET` carga todo, `POST` escribe (valida la contraseña del lado del servidor) |
| `lib/turso.js` | Cliente libSQL compartido + helpers |
| `db/schema.sql` | Esquema SQLite equivalente al de Postgres |
| `scripts/apply-schema.mjs` | Crea las tablas en Turso |
| `scripts/migrate.mjs` | Copia los datos desde Supabase a Turso |
| `index.html` | La capa de datos ahora usa `fetch('/api/data')` en vez de `supabase-js` |

## Pasos para dejarlo andando

### 1. Instalar la CLI de Turso y crear la base

```bash
# Instalar CLI (macOS / Linux)
curl -sSfL https://get.tur.so/install.sh | bash

# Iniciar sesión
turso auth login

# Crear la base
turso db create grupo3-calendario

# Obtener la URL (libsql://...) y un token de acceso
turso db show grupo3-calendario --url
turso db tokens create grupo3-calendario
```

### 2. Exportar variables de entorno (local)

```bash
export TURSO_DATABASE_URL="libsql://grupo3-calendario-<tu-org>.turso.io"
export TURSO_AUTH_TOKEN="<token-que-te-dio-el-comando-anterior>"
```

### 3. Crear el esquema y migrar los datos

```bash
npm install
npm run schema     # crea las tablas en Turso
npm run migrate    # copia config/companies/meetings desde Supabase
```

> `migrate.mjs` lee de Supabase con la anon key (ya pública). Si Supabase ya no
> existe, podés saltarte este paso y la app arranca con el estado por defecto.

### 4. Configurar Vercel

En el proyecto de Vercel → **Settings → Environment Variables**, agregá:

| Variable | Valor |
|----------|-------|
| `TURSO_DATABASE_URL` | la URL `libsql://...` |
| `TURSO_AUTH_TOKEN` | el token de Turso |
| `EDIT_PASSWORD` | la contraseña de edición (ej. `A1234b`) |

Luego redeploy. Vercel detecta automáticamente `api/data.js` como función
serverless y sirve `index.html` como estático.

## Notas de mapeo de tipos (Postgres → SQLite)

- `jsonb` (`matrix`, `reps`) → `TEXT` con JSON serializado.
- `boolean` (`active`, `fixed`) → `INTEGER` 0/1.
- El resto se mantiene como `TEXT` / `INTEGER` / `REAL`.

## Seguridad

Esto es **más seguro** que el esquema anterior: antes tanto la anon key como la
contraseña de edición estaban a la vista en el HTML. Ahora el token de Turso vive
solo en el servidor y la contraseña de edición se valida en `/api/data`. La
contraseña que queda en el HTML solo sirve para desbloquear la UI.

# Migración Supabase → Turso

La app dejó de hablar directo con Supabase. Ahora el navegador llama a una
función serverless (`/api/db`) que es la única que conoce el token de Turso.
Ventajas:

- El **token de Turso no queda expuesto** en el código del navegador.
- La **contraseña del Modo Edición** ahora se valida de verdad en el servidor
  (antes era solo cosmética: cualquiera podía escribir con la anon key).

## Arquitectura

```
Navegador (index.html)
   │  GET  /api/db            → leer config + companies + meetings   (público)
   │  POST /api/db {action}   → escribir (requiere contraseña)
   ▼
Función serverless en Vercel (api/db.js)  ──(token server-side)──►  Turso (libSQL)
```

Archivos nuevos:
- `api/db.js` — función serverless (proxy a Turso).
- `schema.sql` — esquema de las 3 tablas en Turso.
- `scripts/migrate.mjs` — copia los datos de Supabase a Turso (se corre una vez).
- `package.json` — dependencia `@libsql/client`.

---

## Pasos (una sola vez)

### 1. Variables de entorno en Vercel

En **Vercel → tu proyecto → Settings → Environment Variables**, agregá:

| Nombre                | Valor                                              |
|-----------------------|----------------------------------------------------|
| `TURSO_DATABASE_URL`  | la URL de tu base, ej. `libsql://...-org.turso.io` |
| `TURSO_AUTH_TOKEN`    | el auth token de Turso                             |
| `EDIT_PASSWORD`       | la contraseña del Modo Edición (ej. `A1234b`)      |

> Aplicalas a *Production* (y *Preview* si querés probar en ramas).

### 2. Migrar los datos (en TU máquina, no en este entorno)

La red de este entorno está restringida, así que la copia de datos se corre
local. Necesitás Node 18+.

```bash
npm install

export TURSO_DATABASE_URL="libsql://tu-base-tu-org.turso.io"
export TURSO_AUTH_TOKEN="tu-token-de-turso"

npm run migrate
```

El script:
1. Crea el esquema en Turso (si no existe).
2. Lee `config`, `companies` y `meetings` de Supabase (con la anon key que ya
   estaba en el HTML — no toca ni borra nada en Supabase).
3. Hace UPSERT en Turso. Es **idempotente**: podés correrlo de nuevo sin
   duplicar nada.
4. Imprime el conteo final para verificar que no se perdió nada.

> Si tu CLI de Turso ya está logueada, podés obtener los valores con:
> `turso db show <tu-base> --url` y `turso db tokens create <tu-base>`.

### 3. Deploy

Hacé deploy en Vercel (push a la rama de producción o redeploy). Vercel va a
instalar `@libsql/client` y publicar la función `/api/db` automáticamente.
El `index.html` se sigue sirviendo como estático.

### 4. Verificar

- Abrí el sitio: deberías ver todos los datos (indicador "Guardado ✓").
- Entrá a **Modo Edición** con la contraseña → debería aceptarla.
- Editá algo → recargá → el cambio persiste (ahora en Turso).

---

## Notas

- Supabase queda intacto como respaldo. Cuando confirmes que todo anda en
  Turso, podés dar de baja el proyecto de Supabase.
- Para probar localmente la función serverless: `vercel dev` (necesita las
  mismas variables de entorno en un `.env` o exportadas).

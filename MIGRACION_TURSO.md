# Migración de Supabase a Turso

La app dejó de hablar directo con Supabase y ahora usa una función serverless en
Vercel (`api/data.js`) que habla con **Turso**. El token de Turso queda en Vercel
y nunca llega al navegador.

```
Navegador (index.html)  ──►  /api/data (Vercel)  ──►  Turso (libSQL)
```

## Puesta en marcha (sin terminal)

La app **se configura sola**: en el primer acceso crea las tablas en Turso
(`CREATE TABLE IF NOT EXISTS`) e importa los datos de Supabase si Turso está
vacío. Lo único necesario es:

1. En **Vercel → Settings → Environment Variables**, agregar:
   | Name | Value |
   |------|-------|
   | `TURSO_DATABASE_URL` | la URL `libsql://...` de Turso |
   | `TURSO_AUTH_TOKEN` | el token de Turso |
   | `EDIT_PASSWORD` | contraseña de edición (opcional, por defecto `A1234b`) |
2. Que el código esté en la rama de producción (merge del branch).
3. Abrir el sitio una vez: se crean las tablas y se copian los datos solos.

## Scripts manuales (respaldo, opcional)

Solo si alguien quiere correrlos desde una máquina con Node:

```bash
export TURSO_DATABASE_URL="..."
export TURSO_AUTH_TOKEN="..."
npm install
npm run schema     # crea las tablas
npm run migrate    # copia datos desde Supabase
```

## Mapeo de tipos (Postgres → SQLite)
- `jsonb` (`matrix`, `reps`) → `TEXT` con JSON.
- `boolean` (`active`, `fixed`) → `INTEGER` 0/1.

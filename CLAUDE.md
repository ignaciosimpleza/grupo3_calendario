# grupo3_calendario — Notas para Claude

## Qué es
Calendario del Grupo 3. Es **un solo `index.html`** estático (Tailwind por CDN)
servido por **Vercel**. La base de datos está en **Turso** (libSQL), detrás de una
función serverless en `api/data.js`. Antes usaba Supabase (migrado).

Sitio: https://grupo3-calendario.vercel.app/

## Arquitectura
```
index.html  ──fetch /api/data──►  api/data.js (Vercel Function)  ──►  Turso (libSQL)
```
- `api/data.js`: `GET` carga config/companies/meetings; `POST` escribe (valida
  `EDIT_PASSWORD` del lado del servidor). Crea las tablas solo
  (`CREATE TABLE IF NOT EXISTS`) e importa de Supabase la primera vez si Turso
  está vacío. NO hace falta correr scripts a mano.
- `lib/turso.js`: cliente libSQL + helpers.
- `db/schema.sql`, `scripts/*.mjs`: respaldo manual (normalmente no se usan).

## Variables de entorno en Vercel (Settings → Environment Variables)
- `TURSO_DATABASE_URL` (obligatoria)
- `TURSO_AUTH_TOKEN` (obligatoria)
- `EDIT_PASSWORD` (opcional; por defecto `A1234b`)

## Preferencias del usuario (IMPORTANTE)
- **Hablar simple y en castellano rioplatense. Nada de jerga técnica.**
- **El usuario NO usa terminal ni línea de comandos.** Nunca le pidas que abra
  una terminal ni que corra comandos. Si algo se puede hacer por código o por
  una web (Vercel/GitHub con clics), hacelo vos o resolvelo en el código.
- Cuando algo dependa sí o sí de él, pedírselo en una sola frase clara y corta,
  diciéndole exactamente dónde hacer clic.
- Este entorno NO puede conectarse directo a Turso (egress bloqueado). Por eso
  todo lo que toque la base se resuelve en código que corre en Vercel, no acá.

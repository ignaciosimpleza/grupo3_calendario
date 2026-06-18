// Aplica db/schema.sql sobre la base de Turso.
// Uso: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/apply-schema.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@libsql/client';

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) { console.error('Falta TURSO_DATABASE_URL'); process.exit(1); }

const client = createClient({ url, authToken });
const sql = await readFile(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('--'));

for (const stmt of statements) {
  await client.execute(stmt);
  console.log('OK:', stmt.split('\n')[0].slice(0, 60));
}
console.log('\nEsquema aplicado correctamente.');

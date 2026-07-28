// Migra los datos desde Supabase hacia Turso.
// Lee las 3 tablas vía la API REST pública de Supabase (anon key) y las inserta en Turso.
//
// Uso:
//   TURSO_DATABASE_URL=...  TURSO_AUTH_TOKEN=...  node scripts/migrate.mjs
//
// Opcionalmente se pueden sobreescribir las credenciales de Supabase con
//   SUPABASE_URL=...  SUPABASE_ANON_KEY=...

import { createClient } from '@libsql/client';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://tfjezjmgulvolrifjpjh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmamV6am1ndWx2b2xyaWZqcGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMxNTMsImV4cCI6MjA5MjM2OTE1M30.kM6TpNuErxItzT-oZDNF95C1UsELWDORFEWIKPAv_N0';

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!url) { console.error('Falta TURSO_DATABASE_URL'); process.exit(1); }

async function sb(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

const toInt = (v) => (v ? 1 : 0);
const jstr = (v) => JSON.stringify(Array.isArray(v) ? v : JSON.parse(v || '[]'));

const client = createClient({ url, authToken });

console.log('Leyendo datos de Supabase...');
const [config, companies, meetings] = await Promise.all([
  sb('config'),
  sb('companies', '&order=sort_order.asc'),
  sb('meetings', '&order=date.asc'),
]);
console.log(`  config: ${config.length}  companies: ${companies.length}  meetings: ${meetings.length}`);

console.log('Insertando en Turso...');

for (const c of config) {
  await client.execute({
    sql: `INSERT INTO config (id, group_name, cadence_days, novedades_ratio, tecnica_ratio, meeting_day_of_week)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET group_name=excluded.group_name, cadence_days=excluded.cadence_days,
            novedades_ratio=excluded.novedades_ratio, tecnica_ratio=excluded.tecnica_ratio,
            meeting_day_of_week=excluded.meeting_day_of_week`,
    args: [c.id, c.group_name, c.cadence_days, c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week],
  });
}

const coStmts = companies.map((c, i) => ({
  sql: `INSERT INTO companies (id, name, color, active, matrix, reps, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, active=excluded.active,
          matrix=excluded.matrix, reps=excluded.reps, sort_order=excluded.sort_order`,
  args: [c.id, c.name, c.color, toInt(c.active), jstr(c.matrix), jstr(c.reps), c.sort_order ?? i],
}));
if (coStmts.length) await client.batch(coStmts, 'write');

const mtStmts = meetings.map((m) => ({
  sql: `INSERT INTO meetings (date, assignment, obs, topic, fixed)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET assignment=excluded.assignment, obs=excluded.obs,
          topic=excluded.topic, fixed=excluded.fixed`,
  args: [m.date, m.assignment, m.obs || '', m.topic || '', toInt(m.fixed)],
}));
for (let i = 0; i < mtStmts.length; i += 100) {
  await client.batch(mtStmts.slice(i, i + 100), 'write');
}

console.log('\nMigración completada.');

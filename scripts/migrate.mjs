// Migración de datos: Supabase  ->  Turso
// ---------------------------------------------------------------
// Corré esto UNA vez, en tu máquina (donde la red sí está abierta).
//
//   1) npm install
//   2) export TURSO_DATABASE_URL="libsql://tu-base-tu-org.turso.io"
//      export TURSO_AUTH_TOKEN="tu-token-de-turso"
//   3) npm run migrate
//
// Lee las 3 tablas de Supabase (con la anon key) y las copia a Turso.
// Es idempotente: podés correrlo varias veces, hace UPSERT (no duplica).
// No toca ni borra nada en Supabase.

import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';

// --- Origen: Supabase (valores por defecto = los del index.html actual) ---
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://tfjezjmgulvolrifjpjh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmamV6am1ndWx2b2xyaWZqcGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMxNTMsImV4cCI6MjA5MjM2OTE1M30.kM6TpNuErxItzT-oZDNF95C1UsELWDORFEWIKPAv_N0';

// --- Destino: Turso ---
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  console.error('✗ Faltan TURSO_DATABASE_URL y/o TURSO_AUTH_TOKEN en el entorno.');
  process.exit(1);
}

const turso = createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN });

async function fetchSupabase(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function toJSON(v, fallback) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return v; // ya viene como texto JSON
  if (v == null) return JSON.stringify(fallback);
  return JSON.stringify(v);
}

async function main() {
  console.log('→ Creando esquema en Turso (si no existe)...');
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  await turso.executeMultiple(schema);

  console.log('→ Leyendo datos de Supabase...');
  const [config, companies, meetings] = await Promise.all([
    fetchSupabase('config'),
    fetchSupabase('companies'),
    fetchSupabase('meetings'),
  ]);
  console.log(
    `   config: ${config.length} · companies: ${companies.length} · meetings: ${meetings.length}`
  );

  // ----- config -----
  for (const c of config) {
    await turso.execute({
      sql: `INSERT INTO config (id, group_name, cadence_days, novedades_ratio, tecnica_ratio, meeting_day_of_week)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              group_name=excluded.group_name, cadence_days=excluded.cadence_days,
              novedades_ratio=excluded.novedades_ratio, tecnica_ratio=excluded.tecnica_ratio,
              meeting_day_of_week=excluded.meeting_day_of_week`,
      args: [
        c.id ?? 1, c.group_name, c.cadence_days,
        c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week,
      ],
    });
  }

  // ----- companies -----
  if (companies.length) {
    await turso.batch(
      companies.map((c, i) => ({
        sql: `INSERT INTO companies (id, name, color, active, matrix, reps, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, color=excluded.color, active=excluded.active,
                matrix=excluded.matrix, reps=excluded.reps, sort_order=excluded.sort_order`,
        args: [
          c.id, c.name, c.color, c.active ? 1 : 0,
          toJSON(c.matrix, [true, true, true, true, true]),
          toJSON(c.reps, []),
          c.sort_order != null ? c.sort_order : i,
        ],
      })),
      'write'
    );
  }

  // ----- meetings -----
  if (meetings.length) {
    await turso.batch(
      meetings.map((m) => ({
        sql: `INSERT INTO meetings (date, assignment, obs, topic, fixed)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET
                assignment=excluded.assignment, obs=excluded.obs,
                topic=excluded.topic, fixed=excluded.fixed`,
        args: [m.date, m.assignment, m.obs || '', m.topic || '', m.fixed ? 1 : 0],
      })),
      'write'
    );
  }

  // ----- verificación -----
  const [vc, vco, vm] = await Promise.all([
    turso.execute('SELECT COUNT(*) AS n FROM config'),
    turso.execute('SELECT COUNT(*) AS n FROM companies'),
    turso.execute('SELECT COUNT(*) AS n FROM meetings'),
  ]);
  console.log('✓ Migración completa. En Turso ahora hay:');
  console.log(
    `   config: ${vc.rows[0].n} · companies: ${vco.rows[0].n} · meetings: ${vm.rows[0].n}`
  );
}

main().catch((e) => {
  console.error('✗ Error en la migración:', e);
  process.exit(1);
});

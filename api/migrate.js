// Migración de datos Supabase -> Turso, ejecutada DESDE EL NAVEGADOR.
//
// Se dispara abriendo la página /migrar.html, escribiendo la contraseña y
// apretando el botón. Corre en el servidor de Vercel (que sí puede hablar
// con Supabase y con Turso), así no necesitás instalar nada en tu compu.
//
// Es idempotente: podés apretar el botón varias veces sin duplicar datos.
// No borra ni modifica nada en Supabase.

import { createClient } from '@libsql/client';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://tfjezjmgulvolrifjpjh.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmamV6am1ndWx2b2xyaWZqcGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMxNTMsImV4cCI6MjA5MjM2OTE1M30.kM6TpNuErxItzT-oZDNF95C1UsELWDORFEWIKPAv_N0';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY, group_name TEXT, cadence_days INTEGER,
  novedades_ratio INTEGER, tecnica_ratio INTEGER, meeting_day_of_week INTEGER
);
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT,
  active INTEGER DEFAULT 1, matrix TEXT, reps TEXT, sort_order INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meetings (
  date TEXT PRIMARY KEY, assignment TEXT, obs TEXT, topic TEXT, fixed INTEGER DEFAULT 0
);
`;

function toJSON(v, fallback) {
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return v;
  if (v == null) return JSON.stringify(fallback);
  return JSON.stringify(v);
}

async function fetchSupabase(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Método no permitido' });
    }

    // Requiere la misma contraseña del Modo Edición.
    const pwd = req.headers['x-edit-password'];
    if (!process.env.EDIT_PASSWORD || pwd !== process.env.EDIT_PASSWORD) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      return res.status(500).json({ error: 'Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en Vercel.' });
    }

    const turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // 1) crear las tablas en Turso si no existen
    await turso.executeMultiple(SCHEMA);

    // 2) leer todo de Supabase
    const [config, companies, meetings] = await Promise.all([
      fetchSupabase('config'),
      fetchSupabase('companies'),
      fetchSupabase('meetings'),
    ]);

    // 3) copiar a Turso (UPSERT, no duplica)
    for (const c of config) {
      await turso.execute({
        sql: `INSERT INTO config (id, group_name, cadence_days, novedades_ratio, tecnica_ratio, meeting_day_of_week)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                group_name=excluded.group_name, cadence_days=excluded.cadence_days,
                novedades_ratio=excluded.novedades_ratio, tecnica_ratio=excluded.tecnica_ratio,
                meeting_day_of_week=excluded.meeting_day_of_week`,
        args: [c.id ?? 1, c.group_name, c.cadence_days, c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week],
      });
    }

    if (companies.length) {
      await turso.batch(companies.map((c, i) => ({
        sql: `INSERT INTO companies (id, name, color, active, matrix, reps, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, color=excluded.color, active=excluded.active,
                matrix=excluded.matrix, reps=excluded.reps, sort_order=excluded.sort_order`,
        args: [c.id, c.name, c.color, c.active ? 1 : 0,
               toJSON(c.matrix, [true, true, true, true, true]), toJSON(c.reps, []),
               c.sort_order != null ? c.sort_order : i],
      })), 'write');
    }

    if (meetings.length) {
      await turso.batch(meetings.map((m) => ({
        sql: `INSERT INTO meetings (date, assignment, obs, topic, fixed)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(date) DO UPDATE SET
                assignment=excluded.assignment, obs=excluded.obs, topic=excluded.topic, fixed=excluded.fixed`,
        args: [m.date, m.assignment, m.obs || '', m.topic || '', m.fixed ? 1 : 0],
      })), 'write');
    }

    // 4) contar lo que quedó en Turso
    const [vc, vco, vm] = await Promise.all([
      turso.execute('SELECT COUNT(*) AS n FROM config'),
      turso.execute('SELECT COUNT(*) AS n FROM companies'),
      turso.execute('SELECT COUNT(*) AS n FROM meetings'),
    ]);

    return res.status(200).json({
      ok: true,
      leido:   { config: config.length, empresas: companies.length, reuniones: meetings.length },
      enTurso: { config: Number(vc.rows[0].n), empresas: Number(vco.rows[0].n), reuniones: Number(vm.rows[0].n) },
    });
  } catch (e) {
    console.error('Migración error:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

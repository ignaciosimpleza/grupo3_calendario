import { getClient, toBool, toInt, parseJsonArray } from '../lib/turso.js';

// Credenciales públicas de Supabase (solo lectura, anon key) usadas para la
// importación automática de datos la primera vez. Se pueden sobreescribir con
// variables de entorno si hiciera falta.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tfjezjmgulvolrifjpjh.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRmamV6am1ndWx2b2xyaWZqcGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3OTMxNTMsImV4cCI6MjA5MjM2OTE1M30.kM6TpNuErxItzT-oZDNF95C1UsELWDORFEWIKPAv_N0';

// El esquema se crea solo (CREATE TABLE IF NOT EXISTS), así no hace falta correr
// ningún script a mano: en el primer request las tablas quedan listas.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY, group_name TEXT, cadence_days INTEGER,
    novedades_ratio REAL, tecnica_ratio REAL, meeting_day_of_week INTEGER)`,
  `CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY, name TEXT, color TEXT, active INTEGER DEFAULT 1,
    matrix TEXT DEFAULT '[true,true,true,true,true]', reps TEXT DEFAULT '[]',
    sort_order INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS meetings (
    date TEXT PRIMARY KEY, assignment TEXT, obs TEXT DEFAULT '',
    topic TEXT DEFAULT '', fixed INTEGER DEFAULT 0)`,
];

let _schemaReady = false;
async function ensureSchema(client) {
  if (_schemaReady) return;
  for (const stmt of SCHEMA_STATEMENTS) await client.execute(stmt);
  _schemaReady = true;
}

// SQL de upsert (INSERT ... ON CONFLICT) equivalente a los .upsert() de Supabase.
const UPSERT_CONFIG = `
  INSERT INTO config (id, group_name, cadence_days, novedades_ratio, tecnica_ratio, meeting_day_of_week)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    group_name = excluded.group_name,
    cadence_days = excluded.cadence_days,
    novedades_ratio = excluded.novedades_ratio,
    tecnica_ratio = excluded.tecnica_ratio,
    meeting_day_of_week = excluded.meeting_day_of_week`;

const UPSERT_COMPANY = `
  INSERT INTO companies (id, name, color, active, matrix, reps, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    color = excluded.color,
    active = excluded.active,
    matrix = excluded.matrix,
    reps = excluded.reps,
    sort_order = excluded.sort_order`;

const UPSERT_MEETING = `
  INSERT INTO meetings (date, assignment, obs, topic, fixed)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(date) DO UPDATE SET
    assignment = excluded.assignment,
    obs = excluded.obs,
    topic = excluded.topic,
    fixed = excluded.fixed`;

const companyArgs = (co, i) => [
  co.id, co.name, co.color, toInt(co.active),
  JSON.stringify(co.matrix ?? []), JSON.stringify(co.reps ?? []),
  co.sort_order ?? i ?? 0,
];

const meetingArgs = (m) => [
  m.date, m.assignment, m.obs || '', m.topic || '', toInt(m.fixed),
];

async function sbFetch(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table}: ${res.status}`);
  return res.json();
}

// Importa los datos de Supabase a Turso una sola vez, si Turso está vacío.
// Es "best-effort": si falla (p. ej. Supabase ya no existe), la app igual arranca.
async function seedFromSupabaseIfEmpty(client) {
  const counts = await client.execute(
    'SELECT (SELECT COUNT(*) FROM config) AS c, (SELECT COUNT(*) FROM companies) AS co, (SELECT COUNT(*) FROM meetings) AS m'
  );
  const row = counts.rows[0];
  if (Number(row.c) + Number(row.co) + Number(row.m) > 0) return; // ya hay datos

  const [config, companies, meetings] = await Promise.all([
    sbFetch('config'),
    sbFetch('companies', '&order=sort_order.asc'),
    sbFetch('meetings', '&order=date.asc'),
  ]);

  const stmts = [];
  for (const c of config) {
    stmts.push({ sql: UPSERT_CONFIG, args: [1, c.group_name, c.cadence_days, c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week] });
  }
  companies.forEach((c, i) => stmts.push({
    sql: UPSERT_COMPANY,
    args: [c.id, c.name, c.color, toInt(c.active), JSON.stringify(Array.isArray(c.matrix) ? c.matrix : JSON.parse(c.matrix || '[]')), JSON.stringify(Array.isArray(c.reps) ? c.reps : JSON.parse(c.reps || '[]')), c.sort_order ?? i],
  }));
  for (const m of meetings) {
    stmts.push({ sql: UPSERT_MEETING, args: [m.date, m.assignment, m.obs || '', m.topic || '', toInt(m.fixed)] });
  }
  for (let i = 0; i < stmts.length; i += 100) {
    await client.batch(stmts.slice(i, i + 100), 'write');
  }
}

async function loadAll(client) {
  const [cfg, cos, mtg] = await Promise.all([
    client.execute('SELECT * FROM config WHERE id = 1'),
    client.execute('SELECT * FROM companies ORDER BY sort_order ASC'),
    client.execute('SELECT * FROM meetings ORDER BY date ASC'),
  ]);
  return {
    config: cfg.rows[0]
      ? {
          id: cfg.rows[0].id,
          group_name: cfg.rows[0].group_name,
          cadence_days: cfg.rows[0].cadence_days,
          novedades_ratio: cfg.rows[0].novedades_ratio,
          tecnica_ratio: cfg.rows[0].tecnica_ratio,
          meeting_day_of_week: cfg.rows[0].meeting_day_of_week,
        }
      : null,
    companies: cos.rows.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      active: toBool(c.active),
      matrix: parseJsonArray(c.matrix, [true, true, true, true, true]),
      reps: parseJsonArray(c.reps, []),
    })),
    meetings: mtg.rows.map((m) => ({
      date: m.date,
      assignment: m.assignment,
      obs: m.obs || '',
      topic: m.topic || '',
      fixed: toBool(m.fixed),
    })),
  };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  let client;
  try {
    client = getClient();
  } catch (e) {
    res.status(500).json({ error: e.message });
    return;
  }

  // ---- LOAD ----
  if (req.method === 'GET') {
    try {
      await ensureSchema(client);
      // Importación automática (una sola vez) desde Supabase. Nunca rompe la carga.
      try { await seedFromSupabaseIfEmpty(client); }
      catch (e) { console.warn('Seed automático omitido:', e.message); }
      res.status(200).json(await loadAll(client));
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
    return;
  }

  // ---- MUTATIONS ----
  if (req.method === 'POST') {
    const body = await readBody(req);
    const { action, password, payload } = body;

    // La contraseña de edición se valida en el servidor (no en el navegador).
    const EXPECTED = process.env.EDIT_PASSWORD || 'A1234b';
    if (password !== EXPECTED) {
      res.status(401).json({ error: 'No autorizado' });
      return;
    }

    try {
      await ensureSchema(client);
      switch (action) {
        case 'saveConfig': {
          const c = payload;
          await client.execute({
            sql: UPSERT_CONFIG,
            args: [1, c.group_name, c.cadence_days, c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week],
          });
          break;
        }
        case 'saveCompany': {
          await client.execute({ sql: UPSERT_COMPANY, args: companyArgs(payload) });
          break;
        }
        case 'saveAllCompanies': {
          const stmts = (payload || []).map((co, i) => ({ sql: UPSERT_COMPANY, args: companyArgs(co, i) }));
          if (stmts.length) await client.batch(stmts, 'write');
          break;
        }
        case 'deleteCompany': {
          await client.execute({ sql: 'DELETE FROM companies WHERE id = ?', args: [payload.id] });
          break;
        }
        case 'saveMeeting': {
          await client.execute({ sql: UPSERT_MEETING, args: meetingArgs(payload) });
          break;
        }
        case 'saveAllMeetings': {
          const stmts = (payload || []).map((m) => ({ sql: UPSERT_MEETING, args: meetingArgs(m) }));
          // Insertamos por lotes para no exceder límites de la API.
          for (let i = 0; i < stmts.length; i += 100) {
            await client.batch(stmts.slice(i, i + 100), 'write');
          }
          break;
        }
        case 'deleteAllMeetings': {
          await client.execute('DELETE FROM meetings');
          break;
        }
        default:
          res.status(400).json({ error: `Acción desconocida: ${action}` });
          return;
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e.message || e) });
    }
    return;
  }

  res.status(405).json({ error: 'Método no permitido' });
}

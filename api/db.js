// Función serverless de Vercel: única puerta de entrada a Turso.
//
//   GET  /api/db            -> carga { config, companies, meetings }   (público)
//   POST /api/db { action } -> mutaciones                              (requiere contraseña)
//
// El token de Turso y la contraseña viven SOLO en variables de entorno
// del servidor (Vercel), nunca en el código que llega al navegador.
//
// Variables de entorno requeridas (Vercel -> Settings -> Environment Variables):
//   TURSO_DATABASE_URL   ej: libsql://tu-base-tu-org.turso.io
//   TURSO_AUTH_TOKEN     el token de Turso
//   EDIT_PASSWORD        contraseña para el "Modo Edición"

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const EDIT_PASSWORD = process.env.EDIT_PASSWORD || '';

// ---------- helpers de mapeo (fila SQLite -> objeto del front) ----------
function parseJSON(v, fallback) {
  if (Array.isArray(v)) return v;
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function mapConfig(r) {
  if (!r) return null;
  return {
    group_name:          r.group_name,
    cadence_days:        Number(r.cadence_days),
    novedades_ratio:     Number(r.novedades_ratio),
    tecnica_ratio:       Number(r.tecnica_ratio),
    meeting_day_of_week: Number(r.meeting_day_of_week),
  };
}

function mapCompany(r) {
  return {
    id:     Number(r.id),
    name:   r.name,
    color:  r.color,
    active: !!r.active,
    matrix: parseJSON(r.matrix, [true, true, true, true, true]),
    reps:   parseJSON(r.reps, []),
  };
}

function mapMeeting(r) {
  return {
    date:       r.date,
    assignment: r.assignment,
    obs:        r.obs || '',
    topic:      r.topic || '',
    fixed:      !!r.fixed,
  };
}

// ---------- statements de escritura ----------
function meetingUpsert(m) {
  return {
    sql: `INSERT INTO meetings (date, assignment, obs, topic, fixed)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET
            assignment = excluded.assignment,
            obs        = excluded.obs,
            topic      = excluded.topic,
            fixed      = excluded.fixed`,
    args: [m.date, m.assignment, m.obs || '', m.topic || '', m.fixed ? 1 : 0],
  };
}

function companyUpsert(c, i) {
  return {
    sql: `INSERT INTO companies (id, name, color, active, matrix, reps, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name       = excluded.name,
            color      = excluded.color,
            active     = excluded.active,
            matrix     = excluded.matrix,
            reps       = excluded.reps,
            sort_order = excluded.sort_order`,
    args: [
      c.id, c.name, c.color, c.active ? 1 : 0,
      JSON.stringify(c.matrix || [true, true, true, true, true]),
      JSON.stringify(c.reps || []),
      c.sort_order != null ? c.sort_order : i,
    ],
  };
}

export default async function handler(req, res) {
  try {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      return res.status(500).json({ error: 'Faltan TURSO_DATABASE_URL / TURSO_AUTH_TOKEN en el servidor.' });
    }

    // ---------------- LECTURA (pública) ----------------
    if (req.method === 'GET') {
      const [cfg, cos, mtg] = await Promise.all([
        client.execute('SELECT * FROM config WHERE id = 1'),
        client.execute('SELECT * FROM companies ORDER BY sort_order ASC'),
        client.execute('SELECT * FROM meetings ORDER BY date ASC'),
      ]);
      return res.status(200).json({
        config:    mapConfig(cfg.rows[0]),
        companies: cos.rows.map(mapCompany),
        meetings:  mtg.rows.map(mapMeeting),
      });
    }

    // ---------------- ESCRITURA (requiere contraseña) ----------------
    if (req.method === 'POST') {
      const pwd = req.headers['x-edit-password'];
      if (!EDIT_PASSWORD || pwd !== EDIT_PASSWORD) {
        return res.status(401).json({ error: 'No autorizado' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { action } = body;

      switch (action) {
        case 'auth.check':
          return res.status(200).json({ ok: true });

        case 'meeting.upsert': {
          const rows = body.rows || [];
          if (rows.length) await client.batch(rows.map(meetingUpsert), 'write');
          return res.status(200).json({ ok: true, count: rows.length });
        }

        case 'meeting.deleteAll':
          await client.execute("DELETE FROM meetings WHERE date >= '2000-01-01'");
          return res.status(200).json({ ok: true });

        case 'company.upsert': {
          const rows = body.rows || [];
          if (rows.length) await client.batch(rows.map(companyUpsert), 'write');
          return res.status(200).json({ ok: true, count: rows.length });
        }

        case 'company.delete':
          await client.execute({ sql: 'DELETE FROM companies WHERE id = ?', args: [body.id] });
          return res.status(200).json({ ok: true });

        case 'config.upsert': {
          const c = body.config || {};
          await client.execute({
            sql: `INSERT INTO config (id, group_name, cadence_days, novedades_ratio, tecnica_ratio, meeting_day_of_week)
                  VALUES (1, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    group_name          = excluded.group_name,
                    cadence_days        = excluded.cadence_days,
                    novedades_ratio     = excluded.novedades_ratio,
                    tecnica_ratio       = excluded.tecnica_ratio,
                    meeting_day_of_week = excluded.meeting_day_of_week`,
            args: [c.group_name, c.cadence_days, c.novedades_ratio, c.tecnica_ratio, c.meeting_day_of_week],
          });
          return res.status(200).json({ ok: true });
        }

        default:
          return res.status(400).json({ error: `Acción desconocida: ${action}` });
      }
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    console.error('API /api/db error:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

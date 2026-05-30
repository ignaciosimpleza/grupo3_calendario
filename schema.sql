-- Esquema de la base de datos en Turso (libSQL / SQLite)
-- Equivalente 1:1 al esquema de Supabase (Postgres).
-- Notas de tipos:
--   * SQLite no tiene BOOLEAN: se usa INTEGER 0/1 para active/fixed.
--   * Los arrays (matrix, reps) se guardan como TEXT con JSON.

CREATE TABLE IF NOT EXISTS config (
  id                  INTEGER PRIMARY KEY,
  group_name          TEXT,
  cadence_days        INTEGER,
  novedades_ratio     INTEGER,
  tecnica_ratio       INTEGER,
  meeting_day_of_week INTEGER
);

CREATE TABLE IF NOT EXISTS companies (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT,
  active      INTEGER DEFAULT 1,   -- 0 / 1
  matrix      TEXT,                -- JSON: [true,true,true,true,true]
  reps        TEXT,                -- JSON: ["Nombre", ...]
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meetings (
  date        TEXT PRIMARY KEY,    -- 'YYYY-MM-DD'
  assignment  TEXT,
  obs         TEXT,
  topic       TEXT,
  fixed       INTEGER DEFAULT 0    -- 0 / 1
);

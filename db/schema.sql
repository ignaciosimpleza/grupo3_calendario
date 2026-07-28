-- Esquema SQLite/libSQL para Turso.
-- Equivalente a las tablas que estaban en Supabase (Postgres).
-- Notas de mapeo de tipos:
--   jsonb (matrix, reps) -> TEXT con JSON serializado
--   boolean (active, fixed) -> INTEGER 0/1

CREATE TABLE IF NOT EXISTS config (
  id                  INTEGER PRIMARY KEY,
  group_name          TEXT,
  cadence_days        INTEGER,
  novedades_ratio     REAL,
  tecnica_ratio       REAL,
  meeting_day_of_week INTEGER
);

CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY,
  name       TEXT,
  color      TEXT,
  active     INTEGER DEFAULT 1,
  matrix     TEXT    DEFAULT '[true,true,true,true,true]',
  reps       TEXT    DEFAULT '[]',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meetings (
  date       TEXT PRIMARY KEY,
  assignment TEXT,
  obs        TEXT DEFAULT '',
  topic      TEXT DEFAULT '',
  fixed      INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_companies_sort ON companies (sort_order);

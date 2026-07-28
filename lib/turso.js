import { createClient } from '@libsql/client';

let _client = null;

// Cliente libSQL reutilizado entre invocaciones (warm) de la función serverless.
export function getClient() {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('Falta la variable de entorno TURSO_DATABASE_URL');
  _client = createClient({ url, authToken });
  return _client;
}

export const toBool = (v) => v === 1 || v === true || v === '1';
export const toInt = (v) => (v ? 1 : 0);

// matrix/reps se guardan como TEXT (JSON). Devolvemos siempre arrays al cliente.
export function parseJsonArray(v, fallback) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

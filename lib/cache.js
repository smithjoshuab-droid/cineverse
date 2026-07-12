'use strict';
// Enrichment cache: fast in-memory layer + optional Postgres layer (survives restarts).
// Failures here must never break a request — everything is try/catch'd.

const DB_URL = process.env.DATABASE_URL || '';
const TTL_MS = 24 * 60 * 60 * 1000;

const mem = new Map(); // key -> { at, val }

let pool = null;
let ready = null;

function pgPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  let host = '';
  try { host = new URL(DB_URL).hostname; } catch { /* ignore */ }
  pool = new Pool({
    connectionString: DB_URL,
    ssl: host.includes('.') && host !== 'localhost' ? { rejectUnauthorized: false } : false,
    max: 2
  });
  return pool;
}

function ensureReady() {
  if (!DB_URL) return Promise.resolve();
  if (!ready) {
    ready = pgPool().query(`CREATE TABLE IF NOT EXISTS enrich_cache (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`).catch(err => { console.error('enrich_cache init:', err.message); });
  }
  return ready;
}

async function get(key) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.val;
  if (!DB_URL) return null;
  try {
    await ensureReady();
    const { rows } = await pgPool().query(
      `SELECT data FROM enrich_cache WHERE key = $1 AND updated_at > now() - interval '24 hours'`,
      [key]
    );
    if (!rows[0]) return null;
    const val = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    mem.set(key, { at: Date.now(), val });
    return val;
  } catch { return null; }
}

async function set(key, val) {
  mem.set(key, { at: Date.now(), val });
  if (mem.size > 5000) {
    for (const k of [...mem.keys()].slice(0, 1000)) mem.delete(k);
  }
  if (!DB_URL) return;
  try {
    await ensureReady();
    await pgPool().query(
      `INSERT INTO enrich_cache (key, data, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET data = $2, updated_at = now()`,
      [key, JSON.stringify(val)]
    );
  } catch { /* memory layer still works */ }
}

module.exports = { get, set };

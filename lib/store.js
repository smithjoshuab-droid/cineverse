'use strict';
// User + watchlist store.
// Uses Postgres when DATABASE_URL is set (persistent — survives redeploys).
// Falls back to JSON files in data/ otherwise (fine for local dev).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL || '';

/* ============================ Postgres backend ============================ */

let pool = null;
let ready = null;

function pgPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  let host = '';
  try { host = new URL(DB_URL).hostname; } catch { /* leave blank */ }
  pool = new Pool({
    connectionString: DB_URL,
    // Hosted Postgres (Neon, Render external, etc.) needs SSL; internal/local hosts don't.
    ssl: host.includes('.') && host !== 'localhost' ? { rejectUnauthorized: false } : false,
    max: 5
  });
  return pool;
}

async function initPg() {
  await pgPool().query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    pass_hash TEXT NOT NULL,
    recovery_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pgPool().query(`CREATE TABLE IF NOT EXISTS watchlist_items (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    item JSONB NOT NULL,
    added_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, key)
  )`);
}

function ensureReady() {
  if (!ready) ready = initPg();
  return ready;
}

const rowToUser = r => r
  ? { id: r.id, email: r.email, name: r.name, passHash: r.pass_hash, recoveryHash: r.recovery_hash }
  : null;

const FIELD_COLS = { email: 'email', name: 'name', passHash: 'pass_hash', recoveryHash: 'recovery_hash' };

const pgStore = {
  backend: 'postgres',

  async findUserByEmail(email) {
    await ensureReady();
    const { rows } = await pgPool().query(
      'SELECT * FROM users WHERE email = $1',
      [String(email || '').trim().toLowerCase()]
    );
    return rowToUser(rows[0]);
  },

  async findUserById(id) {
    await ensureReady();
    const { rows } = await pgPool().query('SELECT * FROM users WHERE id = $1', [String(id)]);
    return rowToUser(rows[0]);
  },

  async createUser({ email, name, passHash, recoveryHash }) {
    await ensureReady();
    const user = {
      id: crypto.randomUUID(),
      email: String(email).trim().toLowerCase(),
      name: String(name || '').trim(),
      passHash,
      recoveryHash: recoveryHash || null
    };
    await pgPool().query(
      'INSERT INTO users (id, email, name, pass_hash, recovery_hash) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.email, user.name, user.passHash, user.recoveryHash]
    );
    return user;
  },

  async updateUser(id, fields) {
    await ensureReady();
    const sets = [];
    const vals = [];
    for (const [k, col] of Object.entries(FIELD_COLS)) {
      if (fields[k] !== undefined) {
        vals.push(fields[k]);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    if (!sets.length) return this.findUserById(id);
    vals.push(String(id));
    const { rows } = await pgPool().query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals
    );
    return rowToUser(rows[0]);
  },

  async getWatchlist(userId) {
    await ensureReady();
    const { rows } = await pgPool().query(
      'SELECT item FROM watchlist_items WHERE user_id = $1 ORDER BY added_at ASC, key ASC',
      [String(userId)]
    );
    return rows.map(r => (typeof r.item === 'string' ? JSON.parse(r.item) : r.item));
  },

  async addToWatchlist(userId, item) {
    await ensureReady();
    const key = `${item.mediaType}:${item.id}`;
    const full = { ...item, key, addedAt: new Date().toISOString() };
    await pgPool().query(
      'INSERT INTO watchlist_items (user_id, key, item) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO NOTHING',
      [String(userId), key, JSON.stringify(full)]
    );
    return this.getWatchlist(userId);
  },

  async removeFromWatchlist(userId, mediaType, id) {
    await ensureReady();
    await pgPool().query(
      'DELETE FROM watchlist_items WHERE user_id = $1 AND key = $2',
      [String(userId), `${mediaType}:${id}`]
    );
    return this.getWatchlist(userId);
  }
};

/* ========================= JSON-file backend (dev) ======================== */

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LISTS_FILE = path.join(DATA_DIR, 'watchlists.json');

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
const getUsers = () => loadJson(USERS_FILE, []);
const getAllLists = () => loadJson(LISTS_FILE, {});

const fileStore = {
  backend: 'file (set DATABASE_URL for persistence)',

  async findUserByEmail(email) {
    const needle = String(email || '').trim().toLowerCase();
    return getUsers().find(u => u.email === needle) || null;
  },

  async findUserById(id) {
    return getUsers().find(u => u.id === id) || null;
  },

  async createUser({ email, name, passHash, recoveryHash }) {
    const users = getUsers();
    const user = {
      id: crypto.randomUUID(),
      email: String(email).trim().toLowerCase(),
      name: String(name || '').trim(),
      passHash,
      recoveryHash: recoveryHash || null,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveJson(USERS_FILE, users);
    return user;
  },

  async updateUser(id, fields) {
    const users = getUsers();
    const u = users.find(x => x.id === id);
    if (u) { Object.assign(u, fields); saveJson(USERS_FILE, users); }
    return u || null;
  },

  async getWatchlist(userId) {
    return getAllLists()[userId] || [];
  },

  async addToWatchlist(userId, item) {
    const lists = getAllLists();
    const list = lists[userId] || [];
    const key = `${item.mediaType}:${item.id}`;
    if (!list.some(x => x.key === key)) {
      list.push({ ...item, key, addedAt: new Date().toISOString() });
      lists[userId] = list;
      saveJson(LISTS_FILE, lists);
    }
    return list;
  },

  async removeFromWatchlist(userId, mediaType, id) {
    const lists = getAllLists();
    const key = `${mediaType}:${id}`;
    lists[userId] = (lists[userId] || []).filter(x => x.key !== key);
    saveJson(LISTS_FILE, lists);
    return lists[userId];
  }
};

module.exports = DB_URL ? pgStore : fileStore;

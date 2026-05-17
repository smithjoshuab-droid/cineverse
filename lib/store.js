'use strict';

/**
 * Tiny file-backed JSON store for users + watchlists.
 *
 * This is intentionally simple â fine for a demo / single-machine app.
 * For a real multi-user deployment, swap this for SQLite or Postgres.
 *
 * Concurrency: each write serializes through an async-mutex per file so we
 * don't get torn writes if two requests land at once.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WATCHLISTS_FILE = path.join(DATA_DIR, 'watchlists.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) return fallback;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error(`[store] failed to read ${file}:`, e.message);
    return fallback;
  }
}

// Per-file write queue to avoid races
const queues = new Map();
function writeJson(file, value) {
  const prev = queues.get(file) || Promise.resolve();
  const next = prev.then(() => {
    return new Promise((resolve, reject) => {
      ensureDir();
      const tmp = file + '.tmp';
      fs.writeFile(tmp, JSON.stringify(value, null, 2), (err) => {
        if (err) return reject(err);
        fs.rename(tmp, file, (err2) => (err2 ? reject(err2) : resolve()));
      });
    });
  });
  // keep chain even if a write fails â but don't propagate the failure to subsequent writes
  queues.set(file, next.catch(() => {}));
  return next;
}

// ---------- Users ----------

function loadUsers() {
  return readJson(USERS_FILE, { users: [] });
}

async function saveUsers(state) {
  await writeJson(USERS_FILE, state);
}

function findUserByEmail(email) {
  const { users } = loadUsers();
  const norm = String(email || '').trim().toLowerCase();
  return users.find((u) => u.email === norm) || null;
}

function findUserById(id) {
  const { users } = loadUsers();
  return users.find((u) => u.id === id) || null;
}

async function createUser({ email, passwordHash, name }) {
  const state = loadUsers();
  const norm = String(email || '').trim().toLowerCase();
  if (state.users.some((u) => u.email === norm)) {
    const err = new Error('An account with that email already exists.');
    err.status = 409;
    throw err;
  }
  const user = {
    id: crypto.randomUUID(),
    email: norm,
    name: (name || norm.split('@')[0]).slice(0, 60),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  state.users.push(user);
  await saveUsers(state);
  return user;
}

// ---------- Watchlists ----------

function loadWatchlists() {
  return readJson(WATCHLISTS_FILE, { watchlists: {} });
}

async function saveWatchlists(state) {
  await writeJson(WATCHLISTS_FILE, state);
}

// Watchlist entries use { type, id, addedAt }. Older entries (created before
// TV support shipped) only have `movieId` â we migrate them on read.
function getWatchlist(userId) {
  const { watchlists } = loadWatchlists();
  const raw = watchlists[userId] || [];
  return raw.map((e) => (e.type && e.id != null) ? e : { type: 'movie', id: e.movieId, addedAt: e.addedAt });
}

function _validate(type, id) {
  if (type !== 'movie' && type !== 'tv') {
    const err = new Error('type must be "movie" or "tv".'); err.status = 400; throw err;
  }
  const num = Number(id);
  if (!Number.isFinite(num)) {
    const err = new Error('Invalid id.'); err.status = 400; throw err;
  }
  return num;
}

async function addToWatchlist(userId, type, id) {
  const numId = _validate(type, id);
  const state = loadWatchlists();
  const list = getWatchlist(userId);
  if (!list.find((e) => e.type === type && e.id === numId)) {
    list.unshift({ type, id: numId, addedAt: new Date().toISOString() });
  }
  state.watchlists[userId] = list;
  await saveWatchlists(state);
  return list;
}

async function removeFromWatchlist(userId, type, id) {
  const numId = _validate(type, id);
  const state = loadWatchlists();
  const list = getWatchlist(userId).filter((e) => !(e.type === type && e.id === numId));
  state.watchlists[userId] = list;
  await saveWatchlists(state);
  return list;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
};

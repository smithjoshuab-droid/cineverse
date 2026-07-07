'use strict';
// File-backed user + watchlist store.
// Demo-grade persistence: JSON files in data/. Swap for SQLite/Postgres for real multi-user scale.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LISTS_FILE = path.join(DATA_DIR, 'watchlists.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(file, value) {
  ensureDir();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// ---- Users ----------------------------------------------------------------

function getUsers() {
  return loadJson(USERS_FILE, []);
}

function findUserByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  return getUsers().find(u => u.email === needle) || null;
}

function findUserById(id) {
  return getUsers().find(u => u.id === id) || null;
}

function createUser({ email, name, passHash, recoveryHash }) {
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
}

// ---- Watchlists ------------------------------------------------------------
// Shape: { [userId]: [ { key, id, mediaType, title, poster, rating, year, services, addedAt } ] }

function getAllLists() {
  return loadJson(LISTS_FILE, {});
}

function getWatchlist(userId) {
  return getAllLists()[userId] || [];
}

function addToWatchlist(userId, item) {
  const lists = getAllLists();
  const list = lists[userId] || [];
  const key = `${item.mediaType}:${item.id}`;
  if (!list.some(x => x.key === key)) {
    list.push({ ...item, key, addedAt: new Date().toISOString() });
    lists[userId] = list;
    saveJson(LISTS_FILE, lists);
  }
  return list;
}

function removeFromWatchlist(userId, mediaType, id) {
  const lists = getAllLists();
  const key = `${mediaType}:${id}`;
  lists[userId] = (lists[userId] || []).filter(x => x.key !== key);
  saveJson(LISTS_FILE, lists);
  return lists[userId];
}

function updateUser(id, fields) {
  const users = getUsers();
  const u = users.find(x => x.id === id);
  if (u) { Object.assign(u, fields); saveJson(USERS_FILE, users); }
  return u || null;
}

module.exports = {
  updateUser,
  findUserByEmail,
  findUserById,
  createUser,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist
};

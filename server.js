'use strict';
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const tmdb = require('./lib/tmdb');
const store = require('./lib/store');
const enrichCache = require('./lib/cache');

if (!process.env.TMDB_API_KEY) {
  console.error('FATAL: TMDB_API_KEY is not set. Copy .env.example to .env and add your key.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const IS_PROD = process.env.NODE_ENV === 'production';
const OMDB_KEY = process.env.OMDB_API_KEY || '';
const COOKIE = 'cv_session';

app.set('trust proxy', 1); // Render sits behind a proxy
app.use(compression());
app.use(express.json());
app.use(cookieParser(SECRET));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// Short shared HTTP cache on public catalog responses
const catalogCache = (req, res, next) => { res.set('Cache-Control', 'public, max-age=300'); next(); };

// ---- Auth helpers ----------------------------------------------------------

function setSession(res, userId) {
  res.cookie(COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
  });
}

async function currentUser(req) {
  const id = req.signedCookies[COOKIE];
  return id ? store.findUserById(id) : null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---- Auth routes -------------------------------------------------------------

function newRecoveryCode() {
  const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
const normalizeCode = c => String(c || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

app.post('/api/auth/signup', wrap(async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !/.+@.+\..+/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await store.findUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists' });
  const recoveryCode = newRecoveryCode();
  const user = await store.createUser({
    email, name,
    passHash: await bcrypt.hash(password, 10),
    recoveryHash: await bcrypt.hash(normalizeCode(recoveryCode), 10)
  });
  setSession(res, user.id);
  res.json({ user: { email: user.email, name: user.name }, recoveryCode });
}));

// Forgot password: email + recovery code -> new password (a fresh code is issued).
app.post('/api/auth/reset', wrap(async (req, res) => {
  const { email, recoveryCode, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = await store.findUserByEmail(email);
  if (!user || !user.recoveryHash || !(await bcrypt.compare(normalizeCode(recoveryCode), user.recoveryHash))) {
    return res.status(401).json({ error: "Email and recovery code don't match" });
  }
  const fresh = newRecoveryCode();
  await store.updateUser(user.id, {
    passHash: await bcrypt.hash(newPassword, 10),
    recoveryHash: await bcrypt.hash(normalizeCode(fresh), 10)
  });
  setSession(res, user.id);
  res.json({ user: { email: user.email, name: user.name }, recoveryCode: fresh });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await store.findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password || '', user.passHash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  setSession(res, user.id);
  res.json({ user: { email: user.email, name: user.name } });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', wrap(async (req, res) => {
  const user = await currentUser(req);
  res.json({ user: user ? { email: user.email, name: user.name } : null });
}));

// ---- Catalog routes ----------------------------------------------------------

app.get('/api/services', (req, res) => {
  res.json(Object.entries(tmdb.SERVICES).map(([slug, s]) => ({ slug, name: s.name })));
});

app.get('/api/genres', catalogCache, wrap(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  res.json(await tmdb.getGenres(type));
}));

app.get('/api/browse', catalogCache, wrap(async (req, res) => {
  const { type = 'movie', service = '', genre = '', sort = 'popularity', page = 1 } = req.query;
  res.json(await tmdb.discover({
    type: type === 'tv' ? 'tv' : 'movie',
    service, genre, sort: sort === 'seasons' ? 'popularity' : sort,
    page: Math.max(1, parseInt(page, 10) || 1)
  }));
}));

app.get('/api/trending', catalogCache, wrap(async (req, res) => {
  const type = ['movie', 'tv', 'all'].includes(req.query.type) ? req.query.type : 'all';
  res.json(await tmdb.trending(type));
}));

app.get('/api/upcoming', catalogCache, wrap(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  res.json(await tmdb.upcoming(type));
}));

app.get('/api/search', catalogCache, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  res.json(await tmdb.search(q, parseInt(req.query.page, 10) || 1));
}));

// IMDb rating via OMDb (cached 24h; quota-friendly), falls back to null.
const OMDB_TTL = 24 * 60 * 60 * 1000; // ratings move slowly — long cache saves daily quota
const omdbCache = new Map();
async function imdbRating(imdbId) {
  if (!OMDB_KEY || !imdbId) return null;
  const hit = omdbCache.get(imdbId);
  if (hit && Date.now() - hit.at < OMDB_TTL) return hit.val;
  try {
    const res = await fetch(`https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=${imdbId}`);
    const data = await res.json();
    const val = data && data.imdbRating && data.imdbRating !== 'N/A'
      ? { rating: parseFloat(data.imdbRating), votes: data.imdbVotes, rated: data.Rated }
      : null;
    omdbCache.set(imdbId, { at: Date.now(), val });
    return val;
  } catch { return null; }
}

// Enrichment for one title (streaming services, seasons, real IMDb rating) — cached 24h,
// persisted to Postgres when available so cold starts stay fast.
async function enrichOne(mediaType, id) {
  const key = `${mediaType}:${id}`;
  const hit = await enrichCache.get(key);
  if (hit) return hit;
  const out = { services: [] };
  const jobs = [
    tmdb.providers(mediaType, id).then(svcs => { out.services = svcs; }).catch(() => {})
  ];
  if (mediaType === 'tv') {
    jobs.push(tmdb.tvBasics(id).then(b => { if (b.seasons) out.seasons = b.seasons; }).catch(() => {}));
  }
  if (OMDB_KEY) {
    jobs.push((async () => {
      const imdbId = await tmdb.imdbIdFor(mediaType, id);
      const imdb = await imdbRating(imdbId);
      if (imdb && imdb.rating) out.imdbRating = imdb.rating;
    })().catch(() => {}));
  }
  await Promise.all(jobs);
  enrichCache.set(key, out);
  return out;
}

// Batch enrichment — the frontend renders lists instantly, then patches these in.
app.post('/api/enrich', wrap(async (req, res) => {
  const keys = (Array.isArray((req.body || {}).keys) ? req.body.keys : []).slice(0, 60);
  const out = {};
  const CHUNK = 10;
  for (let i = 0; i < keys.length; i += CHUNK) {
    await Promise.all(keys.slice(i, i + CHUNK).map(async k => {
      const [type, id] = String(k).split(':');
      if (!['movie', 'tv'].includes(type) || !/^\d+$/.test(id || '')) return;
      out[k] = await enrichOne(type, Number(id));
    }));
  }
  res.json(out);
}));

app.get('/api/title/:type/:id', catalogCache, wrap(async (req, res) => {
  const type = req.params.type === 'tv' ? 'tv' : 'movie';
  const d = await tmdb.details(type, req.params.id);
  const imdb = await imdbRating(d.imdbId);
  if (imdb) { d.imdbRating = imdb.rating; if (!d.certification && imdb.rated && imdb.rated !== 'N/A') d.certification = imdb.rated; }
  res.json(d);
}));

// ---- Watchlist routes ---------------------------------------------------------

app.get('/api/watchlist', requireAuth, wrap(async (req, res) => {
  res.json(await store.getWatchlist(req.user.id));
}));

app.post('/api/watchlist', requireAuth, wrap(async (req, res) => {
  const { id, mediaType, title, poster, rating, year, seasons } = req.body || {};
  let { services } = req.body || {};
  if (!id || !['movie', 'tv'].includes(mediaType)) return res.status(400).json({ error: 'id and mediaType required' });
  let extra = {};
  if (!Array.isArray(services) || !services.length || (mediaType === 'tv' && !seasons)) {
    extra = await enrichOne(mediaType, id); // cached — so the watchlist can sort/group by service
    if (!Array.isArray(services) || !services.length) services = extra.services || [];
  }
  res.json(await store.addToWatchlist(req.user.id, {
    id, mediaType,
    title: String(title || ''),
    poster: poster || null,
    rating: Number(rating) || 0,
    year: String(year || ''),
    seasons: Number(seasons) || extra.seasons || null,
    services: Array.isArray(services) ? services : []
  }));
}));

app.delete('/api/watchlist/:mediaType/:id', requireAuth, wrap(async (req, res) => {
  res.json(await store.removeFromWatchlist(req.user.id, req.params.mediaType, Number(req.params.id)));
}));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`CineVerse running at http://localhost:${PORT} — store: ${store.backend}`));

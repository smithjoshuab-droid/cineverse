'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');

const tmdb = require('./lib/tmdb');
const store = require('./lib/store');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET not set; ephemeral secret generated. Sessions reset on restart.');
}

// Render's free tier (and most PaaS) terminate TLS at the proxy. Trust it so
// secure cookies and req.ip work correctly behind the proxy.
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser(SESSION_SECRET));

// ---------- Session helpers ----------
const SESSION_COOKIE = 'cv_sid';
const SESSION_MAX_AGE = 1000 * 60 * 60 * 24 * 14;
const IS_PROD = process.env.NODE_ENV === 'production';

function setSession(res, userId) {
  res.cookie(SESSION_COOKIE, userId, {
    signed: true, httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD, // require HTTPS in prod, allow HTTP locally
    maxAge: SESSION_MAX_AGE,
  });
}
function clearSession(res) { res.clearCookie(SESSION_COOKIE); }
function getSessionUserId(req) {
  return req.signedCookies && req.signedCookies[SESSION_COOKIE] ? req.signedCookies[SESSION_COOKIE] : null;
}
function requireAuth(req, res, next) {
  const userId = getSessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Not signed in.' });
  const user = store.findUserById(userId);
  if (!user) { clearSession(res); return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
  req.user = user;
  next();
}
function publicUser(u) { return { id: u.id, email: u.email, name: u.name }; }

// ---------- Validation ----------
function validateEmail(email) {
  if (typeof email !== 'string') return false;
  const t = email.trim();
  return t.length >= 5 && t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}
function validatePassword(pw) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200; }

// ===================================================================
// Auth
// ===================================================================
app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    if (!validateEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await store.createUser({ email, passwordHash, name });
    setSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!validateEmail(email) || typeof password !== 'string')
      return res.status(400).json({ error: 'Email and password are required.' });
    const user = store.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    setSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post('/api/auth/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/api/auth/me', (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId) return res.json({ user: null });
  const user = store.findUserById(userId);
  if (!user) { clearSession(res); return res.json({ user: null }); }
  res.json({ user: publicUser(user) });
});

// ===================================================================
// Movies + TV
// ===================================================================

// --- Genres / providers ---
app.get('/api/movies/genres', async (req, res, next) => {
  try {
    if (req.query.type === 'tv') return res.json({ genres: await tmdb.getTvGenres() });
    res.json({ genres: await tmdb.getGenres() });
  } catch (err) { next(err); }
});
app.get('/api/movies/providers', (req, res) => res.json({ providers: tmdb.getProviders() }));

// --- Dashboard (one bundled call) ---
app.get('/api/movies/dashboard', async (req, res, next) => {
  try {
    if (req.query.type === 'tv') {
      const [pop, today, ota] = await Promise.all([tmdb.tvPopular(1), tmdb.tvAiringToday(1), tmdb.tvOnTheAir(1)]);
      return res.json({
        recommended:      pop.results.slice(0, 12),
        recommendedPages: pop.totalPages,
        nowPlaying:       today.results.slice(0, 12),
        nowPlayingPages:  today.totalPages,
        comingSoon:       ota.results.slice(0, 12),
        comingSoonPages:  ota.totalPages,
      });
    }
    const [pop, np, up] = await Promise.all([tmdb.popular(1), tmdb.nowPlaying(1), tmdb.upcoming(1)]);
    res.json({
      recommended:      pop.results.slice(0, 12),
      recommendedPages: pop.totalPages,
      nowPlaying:       np.results.slice(0, 12),
      nowPlayingPages:  np.totalPages,
      comingSoon:       up.results.slice(0, 12),
      comingSoonPages:  up.totalPages,
    });
  } catch (err) { next(err); }
});

// --- Paginated category endpoints (used by Load More on dashboard sections) ---
app.get('/api/movies/popular', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const fn = req.query.type === 'tv' ? tmdb.tvPopular : tmdb.popular;
    res.json(await fn(page));
  } catch (err) { next(err); }
});
app.get('/api/movies/now-playing', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const fn = req.query.type === 'tv' ? tmdb.tvAiringToday : tmdb.nowPlaying;
    res.json(await fn(page));
  } catch (err) { next(err); }
});
app.get('/api/movies/upcoming', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const fn = req.query.type === 'tv' ? tmdb.tvOnTheAir : tmdb.upcoming;
    res.json(await fn(page));
  } catch (err) { next(err); }
});

// --- Discover (filtered) ---
app.get('/api/movies/discover', async (req, res, next) => {
  try {
    const { genre, provider, sort, page, type } = req.query;
    const sortMap = type === 'tv'
      ? { rating: 'vote_average.desc', popular: 'popularity.desc', newest: 'first_air_date.desc', oldest: 'first_air_date.asc', title: 'name.asc' }
      : { rating: 'vote_average.desc', popular: 'popularity.desc', newest: 'primary_release_date.desc', oldest: 'primary_release_date.asc', title: 'title.asc' };
    const sortBy = sortMap[sort] || sortMap.popular;
    const fn = type === 'tv' ? tmdb.tvDiscover : tmdb.discover;
    res.json(await fn({ genreId: genre, providerId: provider, sortBy, page: Number(page) || 1 }));
  } catch (err) { next(err); }
});

// --- Leaving soon (approximated) ---
app.get('/api/movies/leaving-soon', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const fn = req.query.type === 'tv' ? tmdb.tvLeavingSoon : tmdb.leavingSoon;
    res.json(await fn(req.query.provider, page));
  } catch (err) { next(err); }
});

// --- Search (multi: movies + TV) ---
app.get('/api/movies/search', async (req, res, next) => {
  try {
    const { q, page } = req.query;
    res.json(await tmdb.searchMulti(q, Number(page) || 1));
  } catch (err) { next(err); }
});

// --- Details ---
// Routes are namespaced by type so the URL is descriptive: /api/movies/movie/123 or /api/movies/tv/456.
app.get('/api/movies/:type(movie|tv)/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
    const fn = req.params.type === 'tv' ? tmdb.tvDetails : tmdb.movieDetails;
    res.json(await fn(id));
  } catch (err) { next(err); }
});
// Back-compat: /api/movies/:id treated as movie
app.get('/api/movies/:id(\\d+)', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    res.json(await tmdb.movieDetails(id));
  } catch (err) { next(err); }
});

// ===================================================================
// Watchlist (auth required)
// ===================================================================

app.get('/api/watchlist', requireAuth, async (req, res, next) => {
  try {
    const list = store.getWatchlist(req.user.id);
    if (!list.length) return res.json({ items: [] });
    const summaries = await Promise.all(list.map(async (entry) => {
      try {
        const detail = entry.type === 'tv' ? await tmdb.tvDetails(entry.id) : await tmdb.movieDetails(entry.id);
        return {
          type: entry.type,
          id: detail.id,
          addedAt: entry.addedAt,
          title: detail.title,
          poster: detail.poster,
          rating: detail.rating,
          ratingSource: detail.ratingSource,
          releaseDate: detail.releaseDate,
          genres: detail.genres,
          certification: detail.certification,
          streaming: detail.streaming.flatrate,
        };
      } catch (e) {
        return { type: entry.type, id: entry.id, addedAt: entry.addedAt, error: 'Could not load this title.' };
      }
    }));
    res.json({ items: summaries });
  } catch (err) { next(err); }
});

app.post('/api/watchlist/:type(movie|tv)/:id', requireAuth, async (req, res, next) => {
  try {
    const list = await store.addToWatchlist(req.user.id, req.params.type, req.params.id);
    res.json({ items: list });
  } catch (err) { next(err); }
});

app.delete('/api/watchlist/:type(movie|tv)/:id', requireAuth, async (req, res, next) => {
  try {
    const list = await store.removeFromWatchlist(req.user.id, req.params.type, req.params.id);
    res.json({ items: list });
  } catch (err) { next(err); }
});

// ===================================================================
// Static + SPA fallback + error handler
// ===================================================================

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[server]', err);
  if (err.code === 'TMDB_KEY_MISSING') {
    return res.status(500).json({ error: err.message, code: 'TMDB_KEY_MISSING' });
  }
  res.status(status).json({ error: err.message || 'Server error.' });
});

app.listen(PORT, () => {
  console.log(`\n  CineVerse running at http://localhost:${PORT}\n`);
  if (!process.env.TMDB_API_KEY || process.env.TMDB_API_KEY === 'your_tmdb_v3_api_key_here') {
    console.warn('  [warn] TMDB_API_KEY not set â movie endpoints will return 500.\n');
  }
  if (!process.env.OMDB_API_KEY) {
    console.warn('  [info] OMDB_API_KEY not set â IMDb ratings will fall back to TMDB.\n');
  }
});

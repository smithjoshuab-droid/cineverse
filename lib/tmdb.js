'use strict';

/**
 * Wrapper around The Movie Database (TMDB) v3 + OMDB (for real IMDb ratings).
 *
 * Both API keys live in the server's env, never in the browser. The browser
 * only ever sees normalized response shapes from the routes in server.js.
 *
 * Responses are cached in-memory for a short TTL to keep things snappy and
 * stay well under TMDB's 50 req/sec and OMDB's 1k/day limits.
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE  = 'https://image.tmdb.org/t/p';
const OMDB_BASE = 'https://www.omdbapi.com/';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function getTmdbKey() {
  const k = process.env.TMDB_API_KEY;
  if (!k || k === 'your_tmdb_v3_api_key_here') {
    const e = new Error('TMDB_API_KEY is not configured.');
    e.status = 500; e.code = 'TMDB_KEY_MISSING';
    throw e;
  }
  return k;
}
function getOmdbKey() {
  return process.env.OMDB_API_KEY || null;
}
function isV4Token(k) { return k.length > 40; }

async function tmdbFetch(path, params = {}) {
  const key = getTmdbKey();
  const url = new URL(TMDB_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const headers = { Accept: 'application/json' };
  if (isV4Token(key)) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.value;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`TMDB ${res.status} on ${path}: ${body.slice(0, 200)}`);
    e.status = res.status === 401 ? 500 : 502;
    throw e;
  }
  const value = await res.json();
  cache.set(cacheKey, { value, exp: Date.now() + TTL_MS });
  return value;
}

async function omdbFetch(imdbId) {
  if (!imdbId) return null;
  const key = getOmdbKey();
  if (!key) return null; // OMDB is optional â we degrade gracefully without it
  const url = new URL(OMDB_BASE);
  url.searchParams.set('apikey', key);
  url.searchParams.set('i', imdbId);
  url.searchParams.set('tomatoes', 'false');
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.value;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.Response === 'False') return null;
    cache.set(cacheKey, { value: data, exp: Date.now() + TTL_MS });
    return data;
  } catch (_) { return null; }
}

// --- Image URL helpers ---
function poster(p, size = 'w342')   { return p ? `${IMG_BASE}/${size}${p}` : null; }
function backdrop(p, size = 'w1280'){ return p ? `${IMG_BASE}/${size}${p}` : null; }
function profile(p, size = 'w185')  { return p ? `${IMG_BASE}/${size}${p}` : null; }

// --- Featured streaming providers (US). IDs come from /watch/providers/movie. ---
const FEATURED_PROVIDERS = [
  { id: '8',         name: 'Netflix' },
  { id: '9',         name: 'Prime Video' },
  { id: '337',       name: 'Disney+' },
  { id: '1899',      name: 'Max' },
  { id: '15',        name: 'Hulu' },
  { id: '350',       name: 'Apple TV+' },
  { id: '386|387',   name: 'Peacock' },
  { id: '2303|2616', name: 'Paramount+' },   // Premium + Essential (legacy 531 retired)
];
function getProviders() { return FEATURED_PROVIDERS; }

// --- Normalization ---
function summarize(m, type) {
  const inferred = m.media_type || (m.first_air_date !== undefined && !m.release_date ? 'tv' : (m.title ? 'movie' : 'tv'));
  return {
    type: type || inferred,
    id: m.id,
    title: m.title || m.name,
    overview: m.overview,
    poster: poster(m.poster_path),
    backdrop: backdrop(m.backdrop_path, 'w780'),
    rating: typeof m.vote_average === 'number' ? Number(m.vote_average.toFixed(1)) : null,
    voteCount: m.vote_count,
    releaseDate: m.release_date || m.first_air_date || null,
    genreIds: m.genre_ids || [],
  };
}

function region() { return process.env.TMDB_REGION || 'US'; }

// ============================================================
// Movie endpoints
// ============================================================

async function getGenres() {
  const d = await tmdbFetch('/genre/movie/list', { language: 'en-US' });
  return d.genres;
}

async function discover({ genreId, providerId, sortBy = 'popularity.desc', page = 1 } = {}) {
  const params = {
    language: 'en-US',
    sort_by: sortBy,
    include_adult: 'false',
    page,
    watch_region: region(),
    'vote_count.gte': providerId ? 10 : 50,
  };
  if (genreId) params.with_genres = genreId;
  if (providerId) {
    params.with_watch_providers = providerId;
    params.with_watch_monetization_types = 'flatrate';
  }
  const d = await tmdbFetch('/discover/movie', params);
  return { results: d.results.map((r) => summarize(r, 'movie')), page: d.page, totalPages: d.total_pages };
}

async function popular(page = 1) {
  const d = await tmdbFetch('/movie/popular', { language: 'en-US', page });
  return { results: d.results.map((r) => summarize(r, 'movie')), page: d.page, totalPages: d.total_pages };
}
async function upcoming(page = 1) {
  const d = await tmdbFetch('/movie/upcoming', { language: 'en-US', page, region: region() });
  return { results: d.results.map((r) => summarize(r, 'movie')), page: d.page, totalPages: d.total_pages };
}
async function nowPlaying(page = 1) {
  const d = await tmdbFetch('/movie/now_playing', { language: 'en-US', page, region: region() });
  return { results: d.results.map((r) => summarize(r, 'movie')), page: d.page, totalPages: d.total_pages };
}

async function leavingSoon(providerId, page = 1) {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 8);
  const d = await discover({ providerId, sortBy: 'primary_release_date.asc', page });
  const filtered = d.results.filter((m) => m.releaseDate && new Date(m.releaseDate) < cutoff);
  return { results: filtered.length ? filtered : d.results, page: d.page, totalPages: d.totalPages, approximated: true };
}

async function searchMulti(query, page = 1) {
  if (!query || !query.trim()) return { results: [], page: 1, totalPages: 0 };
  const d = await tmdbFetch('/search/multi', { language: 'en-US', query: query.trim(), include_adult: 'false', page });
  const usable = d.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');
  return { results: usable.map((r) => summarize(r, r.media_type)), page: d.page, totalPages: d.total_pages };
}

async function movieDetails(id) {
  const data = await tmdbFetch(`/movie/${id}`, {
    language: 'en-US',
    append_to_response: 'release_dates,credits,keywords,videos,recommendations,watch/providers',
  });
  const omdbPromise = data.imdb_id ? omdbFetch(data.imdb_id) : Promise.resolve(null);
  const providers = data['watch/providers']?.results?.[region()] || {};
  const mapProv = (arr) => (arr || []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ? `${IMG_BASE}/w92${p.logo_path}` : null }));

  let certification = null;
  const us = (data.release_dates?.results || []).find((r) => r.iso_3166_1 === region()) ||
             (data.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US');
  if (us) {
    const cert = us.release_dates.find((rd) => rd.certification && rd.certification.trim());
    if (cert) certification = cert.certification;
  }

  const cast = (data.credits?.cast || []).slice(0, 12).map((c) => ({ id: c.id, name: c.name, character: c.character, photo: profile(c.profile_path) }));
  const directors = (data.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => ({ id: c.id, name: c.name }));
  const keywords = (data.keywords?.keywords || []).map((k) => k.name);
  const trailer = (data.videos?.results || []).find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const recommendations = (data.recommendations?.results || []).slice(0, 8).map((r) => summarize(r, 'movie'));

  const om = await omdbPromise;
  const imdbRating = om && om.imdbRating && om.imdbRating !== 'N/A' ? Number(om.imdbRating) : null;
  const imdbVotes = om && om.imdbVotes && om.imdbVotes !== 'N/A' ? om.imdbVotes : null;
  const tmdbRating = typeof data.vote_average === 'number' ? Number(data.vote_average.toFixed(1)) : null;

  return {
    type: 'movie',
    id: data.id,
    imdbId: data.imdb_id,
    title: data.title,
    tagline: data.tagline,
    overview: data.overview,
    runtime: data.runtime,
    releaseDate: data.release_date,
    poster: poster(data.poster_path, 'w500'),
    backdrop: backdrop(data.backdrop_path, 'original'),
    rating: imdbRating ?? tmdbRating,
    ratingSource: imdbRating != null ? 'IMDb' : 'TMDB',
    tmdbRating, imdbRating, imdbVotes,
    voteCount: data.vote_count,
    genres: (data.genres || []).map((g) => ({ id: g.id, name: g.name })),
    certification,
    cast, directors, keywords,
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    streaming: { flatrate: mapProv(providers.flatrate), rent: mapProv(providers.rent), buy: mapProv(providers.buy) },
    recommendations,
    imdbUrl: data.imdb_id ? `https://www.imdb.com/title/${data.imdb_id}/` : null,
    imdbParentGuideUrl: data.imdb_id ? `https://www.imdb.com/title/${data.imdb_id}/parentalguide` : null,
  };
}

// ============================================================
// TV endpoints
// ============================================================

async function getTvGenres() {
  const d = await tmdbFetch('/genre/tv/list', { language: 'en-US' });
  return d.genres;
}

async function tvPopular(page = 1) {
  const d = await tmdbFetch('/tv/popular', { language: 'en-US', page });
  return { results: d.results.map((r) => summarize(r, 'tv')), page: d.page, totalPages: d.total_pages };
}
async function tvAiringToday(page = 1) {
  const d = await tmdbFetch('/tv/airing_today', { language: 'en-US', page });
  return { results: d.results.map((r) => summarize(r, 'tv')), page: d.page, totalPages: d.total_pages };
}
async function tvOnTheAir(page = 1) {
  const d = await tmdbFetch('/tv/on_the_air', { language: 'en-US', page });
  return { results: d.results.map((r) => summarize(r, 'tv')), page: d.page, totalPages: d.total_pages };
}

async function tvDiscover({ genreId, providerId, sortBy = 'popularity.desc', page = 1 } = {}) {
  const params = {
    language: 'en-US',
    sort_by: sortBy,
    include_adult: 'false',
    page,
    watch_region: region(),
    'vote_count.gte': providerId ? 10 : 50,
  };
  if (genreId) params.with_genres = genreId;
  if (providerId) {
    params.with_watch_providers = providerId;
    params.with_watch_monetization_types = 'flatrate';
  }
  const d = await tmdbFetch('/discover/tv', params);
  return { results: d.results.map((r) => summarize(r, 'tv')), page: d.page, totalPages: d.total_pages };
}

async function tvLeavingSoon(providerId, page = 1) {
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 8);
  const d = await tvDiscover({ providerId, sortBy: 'first_air_date.asc', page });
  const filtered = d.results.filter((m) => m.releaseDate && new Date(m.releaseDate) < cutoff);
  return { results: filtered.length ? filtered : d.results, page: d.page, totalPages: d.totalPages, approximated: true };
}

async function tvDetails(id) {
  const data = await tmdbFetch(`/tv/${id}`, {
    language: 'en-US',
    append_to_response: 'content_ratings,credits,keywords,videos,recommendations,watch/providers,external_ids',
  });
  const imdbId = data.external_ids?.imdb_id || null;
  const omdbPromise = imdbId ? omdbFetch(imdbId) : Promise.resolve(null);
  const providers = data['watch/providers']?.results?.[region()] || {};
  const mapProv = (arr) => (arr || []).map((p) => ({ id: p.provider_id, name: p.provider_name, logo: p.logo_path ? `${IMG_BASE}/w92${p.logo_path}` : null }));

  let certification = null;
  const us = (data.content_ratings?.results || []).find((r) => r.iso_3166_1 === region()) ||
             (data.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US');
  if (us && us.rating && us.rating.trim()) certification = us.rating;

  const cast = (data.credits?.cast || []).slice(0, 12).map((c) => ({ id: c.id, name: c.name, character: c.character, photo: profile(c.profile_path) }));
  const creators = (data.created_by || []).map((c) => ({ id: c.id, name: c.name }));
  const keywords = (data.keywords?.results || data.keywords?.keywords || []).map((k) => k.name);
  const trailer = (data.videos?.results || []).find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const recommendations = (data.recommendations?.results || []).slice(0, 8).map((r) => summarize(r, 'tv'));

  const om = await omdbPromise;
  const imdbRating = om && om.imdbRating && om.imdbRating !== 'N/A' ? Number(om.imdbRating) : null;
  const imdbVotes = om && om.imdbVotes && om.imdbVotes !== 'N/A' ? om.imdbVotes : null;
  const tmdbRating = typeof data.vote_average === 'number' ? Number(data.vote_average.toFixed(1)) : null;

  return {
    type: 'tv',
    id: data.id,
    imdbId,
    title: data.name,
    tagline: data.tagline,
    overview: data.overview,
    runtime: Array.isArray(data.episode_run_time) && data.episode_run_time.length ? data.episode_run_time[0] : null,
    releaseDate: data.first_air_date,
    lastAirDate: data.last_air_date,
    poster: poster(data.poster_path, 'w500'),
    backdrop: backdrop(data.backdrop_path, 'original'),
    rating: imdbRating ?? tmdbRating,
    ratingSource: imdbRating != null ? 'IMDb' : 'TMDB',
    tmdbRating, imdbRating, imdbVotes,
    voteCount: data.vote_count,
    genres: (data.genres || []).map((g) => ({ id: g.id, name: g.name })),
    certification,
    cast,
    directors: creators,
    keywords,
    numberOfSeasons: data.number_of_seasons,
    numberOfEpisodes: data.number_of_episodes,
    status: data.status,
    networks: (data.networks || []).map((n) => ({ id: n.id, name: n.name, logo: n.logo_path ? `${IMG_BASE}/w92${n.logo_path}` : null })),
    trailer: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    streaming: { flatrate: mapProv(providers.flatrate), rent: mapProv(providers.rent), buy: mapProv(providers.buy) },
    recommendations,
    imdbUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    imdbParentGuideUrl: imdbId ? `https://www.imdb.com/title/${imdbId}/parentalguide` : null,
  };
}

module.exports = {
  getProviders,
  // Movies
  getGenres,
  discover, popular, upcoming, nowPlaying, leavingSoon,
  searchMulti,
  movieDetails,
  // TV
  getTvGenres,
  tvPopular, tvAiringToday, tvOnTheAir, tvDiscover, tvLeavingSoon,
  tvDetails,
};

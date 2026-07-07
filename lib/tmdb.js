'use strict';
// TMDB v3 API wrapper — cached, region-aware, movie + TV.
// Accepts either a v3 API key (32 hex chars) or a v4 Read Access Token (JWT), auto-detected.

const API_BASE = 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY || '';
const REGION = process.env.TMDB_REGION || 'US';
const IS_V4 = KEY.length > 40; // v4 tokens are long JWTs; v3 keys are 32 hex chars

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // url -> { at, data }

// Streaming services we surface, keyed by slug used in the UI.
// ids = TMDB watch-provider IDs (multiple ids cover base/ads/premium variants).
// ids sourced from TMDB /watch/providers/movie?watch_region=US (Jul 2026):
// each service includes its base plan, ad plan, and Amazon/Roku/Apple channel variants.
const SERVICES = {
  netflix:    { name: 'Netflix',      ids: [8, 175, 1796] },
  prime:      { name: 'Prime Video',  ids: [9, 119, 613, 2100] },
  disney:     { name: 'Disney+',      ids: [337] },
  max:        { name: 'Max',          ids: [1899, 384, 616, 1825] },
  hulu:       { name: 'Hulu',         ids: [15] },
  apple:      { name: 'Apple TV+',    ids: [350, 2243] },
  peacock:    { name: 'Peacock',      ids: [386, 387, 2553] },
  paramount:  { name: 'Paramount+',   ids: [531, 1770, 2303, 2616, 582, 633, 1853] }
};

const ALL_SERVICE_IDS = Object.values(SERVICES).flatMap(s => s.ids);

function providerIdToSlug(id) {
  for (const [slug, s] of Object.entries(SERVICES)) {
    if (s.ids.includes(id)) return slug;
  }
  return null;
}

async function tmdb(pathname, params = {}) {
  const url = new URL(API_BASE + pathname);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (!IS_V4) url.searchParams.set('api_key', KEY);
  const cacheKey = url.toString();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const res = await fetch(url, {
    headers: IS_V4 ? { Authorization: `Bearer ${KEY}` } : {}
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`TMDB ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  cache.set(cacheKey, { at: Date.now(), data });
  if (cache.size > 500) {
    // simple bound: drop oldest entries
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) cache.delete(k);
  }
  return data;
}

// ---- Normalisation ---------------------------------------------------------

function normalize(item, mediaType) {
  const type = mediaType || item.media_type;
  const isTV = type === 'tv';
  return {
    id: item.id,
    mediaType: type,
    title: isTV ? item.name : item.title,
    year: ((isTV ? item.first_air_date : item.release_date) || '').slice(0, 4),
    date: (isTV ? item.first_air_date : item.release_date) || '',
    overview: item.overview || '',
    poster: item.poster_path,
    backdrop: item.backdrop_path,
    rating: Math.round((item.vote_average || 0) * 10) / 10,
    votes: item.vote_count || 0,
    popularity: item.popularity || 0,
    genreIds: item.genre_ids || (item.genres || []).map(g => g.id)
  };
}

const SORT_MAP = {
  movie: {
    rating: 'vote_average.desc',
    popularity: 'popularity.desc',
    date: 'primary_release_date.desc',
    title: 'original_title.asc'
  },
  tv: {
    rating: 'vote_average.desc',
    popularity: 'popularity.desc',
    date: 'first_air_date.desc',
    title: 'name.asc'
  }
};

// ---- Public API ------------------------------------------------------------

async function getGenres(type) {
  const data = await tmdb(`/genre/${type}/list`);
  return data.genres || [];
}

async function discover({ type = 'movie', service = '', genre = '', sort = 'popularity', page = 1 }) {
  const params = {
    watch_region: REGION,
    with_watch_monetization_types: 'flatrate|free|ads',
    include_adult: false,
    page,
    sort_by: (SORT_MAP[type] || SORT_MAP.movie)[sort] || SORT_MAP[type].popularity
  };
  const svc = SERVICES[service];
  params.with_watch_providers = (svc ? svc.ids : ALL_SERVICE_IDS).join('|');
  if (genre) params.with_genres = genre;
  if (sort === 'rating') params['vote_count.gte'] = 200; // keep junk out of top-rated
  const data = await tmdb(`/discover/${type}`, params);
  return {
    page: data.page,
    totalPages: Math.min(data.total_pages || 1, 500),
    results: (data.results || []).map(r => normalize(r, type))
  };
}

async function trending(type = 'all', window = 'week') {
  const data = await tmdb(`/trending/${type}/${window}`);
  return (data.results || [])
    .filter(r => r.media_type === 'movie' || r.media_type === 'tv' || type !== 'all')
    .map(r => normalize(r, type === 'all' ? undefined : type));
}

async function upcoming(type = 'movie') {
  if (type === 'movie') {
    const data = await tmdb('/movie/upcoming', { region: REGION });
    return (data.results || []).map(r => normalize(r, 'movie'));
  }
  const today = new Date().toISOString().slice(0, 10);
  const data = await tmdb('/discover/tv', {
    'first_air_date.gte': today,
    sort_by: 'popularity.desc',
    watch_region: REGION,
    include_adult: false
  });
  return (data.results || []).map(r => normalize(r, 'tv'));
}

async function search(query, page = 1) {
  const data = await tmdb('/search/multi', { query, page, include_adult: false });
  return {
    page: data.page,
    totalPages: data.total_pages || 1,
    results: (data.results || [])
      .filter(r => r.media_type === 'movie' || r.media_type === 'tv')
      .map(r => normalize(r))
  };
}

async function details(type, id) {
  const append = type === 'movie'
    ? 'credits,videos,release_dates,external_ids,keywords'
    : 'credits,videos,content_ratings,external_ids,keywords';
  const data = await tmdb(`/${type}/${id}`, { append_to_response: append });

  // Where to watch (region-scoped)
  let services = [];
  try {
    const prov = await tmdb(`/${type}/${id}/watch/providers`);
    const regional = (prov.results || {})[REGION] || {};
    const flat = [...(regional.flatrate || []), ...(regional.ads || []), ...(regional.free || [])];
    services = [...new Set(flat.map(p => providerIdToSlug(p.provider_id)).filter(Boolean))];
  } catch { /* non-fatal */ }

  // Certification
  let certification = '';
  if (type === 'movie') {
    const rel = ((data.release_dates || {}).results || []).find(r => r.iso_3166_1 === REGION);
    certification = ((rel || {}).release_dates || []).map(d => d.certification).find(Boolean) || '';
  } else {
    const rat = ((data.content_ratings || {}).results || []).find(r => r.iso_3166_1 === REGION);
    certification = (rat || {}).rating || '';
  }

  const trailer = ((data.videos || {}).results || [])
    .find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
    ((data.videos || {}).results || []).find(v => v.site === 'YouTube');

  const keywords = type === 'movie'
    ? ((data.keywords || {}).keywords || [])
    : ((data.keywords || {}).results || []);

  const imdbId = (data.external_ids || {}).imdb_id || data.imdb_id || null;

  return {
    ...normalize(data, type),
    genres: data.genres || [],
    runtime: type === 'movie' ? data.runtime : null,
    seasons: type === 'tv' ? data.number_of_seasons : null,
    episodes: type === 'tv' ? data.number_of_episodes : null,
    status: data.status,
    tagline: data.tagline || '',
    cast: ((data.credits || {}).cast || []).slice(0, 12).map(c => ({
      name: c.name, character: c.character, profile: c.profile_path
    })),
    trailerKey: trailer ? trailer.key : null,
    certification,
    keywords: keywords.map(k => k.name),
    imdbId,
    services
  };
}

async function imdbIdFor(type, id) {
  try {
    const data = await tmdb(`/${type}/${id}/external_ids`);
    return data.imdb_id || null;
  } catch { return null; }
}

async function tvBasics(id) {
  try {
    const d = await tmdb(`/tv/${id}`);
    return { seasons: d.number_of_seasons || null };
  } catch { return { seasons: null }; }
}

async function providers(type, id) {
  try {
    const prov = await tmdb(`/${type}/${id}/watch/providers`);
    const regional = (prov.results || {})[REGION] || {};
    const flat = [...(regional.flatrate || []), ...(regional.ads || []), ...(regional.free || [])];
    return [...new Set(flat.map(p => providerIdToSlug(p.provider_id)).filter(Boolean))];
  } catch { return []; }
}

module.exports = { SERVICES, getGenres, discover, trending, upcoming, search, details, providers, imdbIdFor, tvBasics };

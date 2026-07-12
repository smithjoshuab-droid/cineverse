'use strict';
/* CineVerse SPA — public browsing, sign-in only for the watchlist.
   Lists render instantly from TMDB, then IMDb ratings / services / seasons
   are patched in from /api/enrich. */

const IMG = 'https://image.tmdb.org/t/p';
const $ = sel => document.querySelector(sel);
const view = () => $('#view');

const state = {
  user: null,
  authKnown: false,           // /api/auth/me resolved
  services: [],
  genres: { movie: [], tv: [] },
  watchKeys: new Set(),
  shared: (() => {
    try { return { service: '', sort: 'popularity', ...JSON.parse(localStorage.getItem('cv_prefs') || '{}') }; }
    catch { return { service: '', sort: 'popularity' }; }
  })(),
  browse: { movies: { genre: '', page: 1 }, series: { genre: '', page: 1 } },
  wlSort: 'added', wlType: 'all', searchSort: '', upSort: '',
  pendingStar: null           // item to add right after a sign-in triggered by a star
};

/* ============================ helpers ============================ */

const apiCache = new Map(); // url/body -> { at, data }
const API_TTL = 5 * 60 * 1000;

async function api(path, opts = {}) {
  const isGet = !opts.method || opts.method === 'GET';
  const cacheable = (isGet && !path.startsWith('/api/auth') && !path.startsWith('/api/watchlist'))
    || path === '/api/enrich';
  const key = path + (opts.body || '');
  if (cacheable) {
    const hit = apiCache.get(key);
    if (hit && Date.now() - hit.at < API_TTL) return hit.data;
  }
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  if (cacheable) {
    apiCache.set(key, { at: Date.now(), data });
    if (apiCache.size > 120) apiCache.delete(apiCache.keys().next().value);
  }
  return data;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 2200);
}
function svcName(slug) { const s = state.services.find(x => x.slug === slug); return s ? s.name : slug; }
function savePrefs() { try { localStorage.setItem('cv_prefs', JSON.stringify(state.shared)); } catch { /* private mode */ } }
function sortList(list, mode) {
  const by = {
    rating: (x, y) => ((y.imdbRating ?? y.rating ?? 0) - (x.imdbRating ?? x.rating ?? 0)),
    seasons: (x, y) => ((y.seasons || 0) - (x.seasons || 0)),
    title: (x, y) => x.title.localeCompare(y.title),
    year: (x, y) => (y.year || '').localeCompare(x.year || '')
  }[mode];
  return by ? [...list].sort(by) : list;
}
function skeletonGrid(n = 14, hscroll = false) {
  const cell = '<div class="sk-card"><div class="sk-poster"></div><div class="sk-line"></div><div class="sk-line short"></div></div>';
  return `<div class="${hscroll ? 'hscroll' : 'grid'}">${cell.repeat(n)}</div>`;
}

/* ============================ cards + enrichment ============================ */

function cardHTML(x) {
  const key = `${x.mediaType}:${x.id}`;
  const on = state.watchKeys.has(key);
  const score = x.imdbRating != null ? x.imdbRating : x.rating;
  const isImdb = x.imdbRating != null;
  const poster = x.poster
    ? `<img class="poster" loading="lazy" src="${IMG}/w342${x.poster}" alt="${esc(x.title)} poster">`
    : `<div class="noposter">🎬</div>`;
  return `<div class="card" data-key="${key}">
    <span class="badge-type">${x.mediaType === 'tv' ? 'Series' : 'Movie'}</span>
    <button class="star ${on ? 'on' : ''}" title="${on ? 'Remove from' : 'Add to'} watchlist"
      data-item='${esc(JSON.stringify({ id: x.id, mediaType: x.mediaType, title: x.title, poster: x.poster, rating: score, year: x.year, services: x.services || [], seasons: x.seasons || null }))}'>${on ? '★' : '☆'}</button>
    ${poster}
    <div class="meta">
      <p class="title">${esc(x.title)}</p>
      <div class="sub">
        <span class="badge-rating" title="${isImdb ? 'IMDb rating' : 'TMDB rating'}">★ ${score ? Number(score).toFixed(1) : '–'}${isImdb ? '<small class="src-imdb"> IMDb</small>' : ''}</span>
        <span>${esc(x.year || '')}</span>
        ${x.mediaType === 'tv' && x.seasons ? `<span title="Seasons">${x.seasons} ssn</span>` : ''}
      </div>
      ${x.services && x.services.length
        ? `<div class="svcline" title="${esc(x.services.map(svcName).join(', '))}">${esc(x.services.slice(0, 2).map(svcName).join(' · '))}${x.services.length > 2 ? ` +${x.services.length - 2}` : ''}</div>`
        : ''}
    </div>
  </div>`;
}

function bindCards(root) {
  root.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.star')) return;
      const [type, id] = card.dataset.key.split(':');
      location.hash = `#/title/${type}/${id}`;
    });
  });
  root.querySelectorAll('.star').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleWatch(JSON.parse(btn.dataset.item), btn);
    });
  });
}

// Fetch IMDb rating / services / seasons for items still missing them,
// then re-render the grid element (optionally re-sorted).
async function enrich(items, gridEl, resortMode) {
  const need = items.filter(x => x.services === undefined);
  if (!need.length || !gridEl) return;
  for (let i = 0; i < need.length; i += 60) {
    const chunk = need.slice(i, i + 60);
    try {
      const map = await api('/api/enrich', {
        method: 'POST',
        body: JSON.stringify({ keys: chunk.map(x => `${x.mediaType}:${x.id}`) })
      });
      for (const x of chunk) {
        const e = map[`${x.mediaType}:${x.id}`];
        if (e) Object.assign(x, e, { services: e.services || [] });
        else x.services = [];
      }
    } catch { chunk.forEach(x => { if (x.services === undefined) x.services = []; }); }
    if (!gridEl.isConnected) return; // user navigated away
    const sorted = resortMode ? sortList(items, resortMode) : items;
    gridEl.innerHTML = sorted.map(cardHTML).join('');
    bindCards(gridEl);
  }
}

/* ============================ auth (modal) ============================ */

let authMode = 'login';

function refreshHeader() {
  const signedIn = !!state.user;
  $('#user-name').classList.toggle('hidden', !signedIn);
  $('#logout-btn').classList.toggle('hidden', !signedIn);
  $('#signin-btn').classList.toggle('hidden', signedIn);
  if (signedIn) $('#user-name').textContent = state.user.name || state.user.email;
}

function openAuth(mode = 'login', tagline) {
  setAuthMode(mode);
  $('#auth-tagline').innerHTML = tagline || 'Sign in to save your watchlist —<br>it syncs to every device.';
  $('#auth-modal').classList.remove('hidden');
  setTimeout(() => $('#auth-email').focus(), 60);
}
function closeAuth() {
  $('#auth-modal').classList.add('hidden');
  $('#auth-form').classList.remove('hidden');
  document.querySelector('.auth-switch').classList.remove('hidden');
  $('#recovery-box').classList.add('hidden');
  state.pendingStar = null;
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup', reset = mode === 'reset';
  $('#auth-name-row').classList.toggle('hidden', !signup);
  $('#auth-code-row').classList.toggle('hidden', !reset);
  $('#auth-password-label').textContent = reset ? 'New password' : 'Password';
  $('#auth-submit').textContent = signup ? 'Create account' : (reset ? 'Reset password' : 'Sign in');
  $('#auth-forgot').classList.toggle('hidden', mode !== 'login');
  $('#auth-switch-label').textContent = mode === 'login' ? 'New here?' : 'Already have an account?';
  $('#auth-switch-link').textContent = mode === 'login' ? 'Create an account' : 'Sign in instead';
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').classList.add('hidden');
}

async function afterAuth() {
  refreshHeader();
  await loadWatchlistKeys();
  if (state.pendingStar) {
    const item = state.pendingStar;
    state.pendingStar = null;
    await toggleWatch(item, null);
  }
  route(); // re-render current view with stars/watchlist state
}

$('#signin-btn').addEventListener('click', () => openAuth('login'));
$('#auth-close').addEventListener('click', closeAuth);
$('#auth-modal').addEventListener('click', e => { if (e.target === $('#auth-modal')) closeAuth(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAuth(); hideSuggestions(); } });
$('#auth-switch-link').addEventListener('click', e => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'signup' : 'login'); });
$('#auth-forgot-link').addEventListener('click', e => { e.preventDefault(); setAuthMode('reset'); });

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  let path = 'login';
  const payload = { email: $('#auth-email').value };
  if (authMode === 'signup') { path = 'signup'; payload.password = $('#auth-password').value; payload.name = $('#auth-name').value; }
  else if (authMode === 'reset') { path = 'reset'; payload.newPassword = $('#auth-password').value; payload.recoveryCode = $('#auth-code').value; }
  else payload.password = $('#auth-password').value;
  try {
    const data = await api(`/api/auth/${path}`, { method: 'POST', body: JSON.stringify(payload) });
    state.user = data.user;
    if (data.recoveryCode) {
      $('#auth-form').classList.add('hidden');
      document.querySelector('.auth-switch').classList.add('hidden');
      $('#recovery-code').textContent = data.recoveryCode;
      $('#recovery-box').classList.remove('hidden');
    } else {
      closeAuth();
      await afterAuth();
      toast(`Welcome back${state.user.name ? ', ' + state.user.name : ''}!`);
    }
  } catch (err) {
    const el = $('#auth-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  }
});

$('#rc-done').addEventListener('click', async () => {
  $('#recovery-box').classList.add('hidden');
  $('#auth-form').classList.remove('hidden');
  document.querySelector('.auth-switch').classList.remove('hidden');
  setAuthMode('login');
  $('#auth-modal').classList.add('hidden');
  await afterAuth();
  toast('Account ready — happy watching!');
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.watchKeys.clear();
  refreshHeader();
  route();
});

async function loadWatchlistKeys() {
  if (!state.user) { state.watchKeys = new Set(); return; }
  try {
    const list = await api('/api/watchlist');
    state.watchKeys = new Set(list.map(x => x.key));
  } catch { state.watchKeys = new Set(); }
}

/* ============================ watchlist toggle ============================ */

async function toggleWatch(item, btn) {
  if (!state.user) {
    state.pendingStar = item;
    openAuth('login', `Sign in to add <b>${esc(item.title)}</b> to your watchlist.`);
    return;
  }
  const key = `${item.mediaType}:${item.id}`;
  try {
    if (state.watchKeys.has(key)) {
      await api(`/api/watchlist/${item.mediaType}/${item.id}`, { method: 'DELETE' });
      state.watchKeys.delete(key);
      toast(`Removed “${item.title}” from watchlist`);
      if (btn) { btn.classList.remove('on'); btn.textContent = '☆'; }
      if (currentRoute().startsWith('#/watchlist')) renderWatchlist();
    } else {
      await api('/api/watchlist', { method: 'POST', body: JSON.stringify(item) });
      state.watchKeys.add(key);
      toast(`Added “${item.title}” to watchlist ★`);
      if (btn) { btn.classList.add('on'); btn.textContent = '★'; }
    }
  } catch (err) { toast(err.message); }
}

/* ============================ search suggestions ============================ */

let sugTimer = null;
function hideSuggestions() { $('#suggestions').classList.add('hidden'); }

$('#search-input').addEventListener('input', () => {
  clearTimeout(sugTimer);
  const q = $('#search-input').value.trim();
  if (q.length < 2) { hideSuggestions(); return; }
  sugTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if ($('#search-input').value.trim() !== q) return; // stale
      const top = data.results.slice(0, 6);
      if (!top.length) { hideSuggestions(); return; }
      $('#suggestions').innerHTML = top.map(x => `
        <div class="sug" data-key="${x.mediaType}:${x.id}">
          ${x.poster ? `<img loading="lazy" src="${IMG}/w92${x.poster}" alt="">` : '<div class="noimg">🎬</div>'}
          <div><div class="s-title">${esc(x.title)}</div>
          <div class="s-sub">${x.mediaType === 'tv' ? 'Series' : 'Movie'}${x.year ? ' · ' + esc(x.year) : ''} · ★ ${x.rating ? x.rating.toFixed(1) : '–'}</div></div>
        </div>`).join('') + `<div class="sug-all">See all results for “${esc(q)}” →</div>`;
      $('#suggestions').classList.remove('hidden');
      $('#suggestions').querySelectorAll('.sug').forEach(el => el.addEventListener('mousedown', () => {
        const [type, id] = el.dataset.key.split(':');
        hideSuggestions();
        location.hash = `#/title/${type}/${id}`;
      }));
      $('#suggestions').querySelector('.sug-all').addEventListener('mousedown', () => {
        hideSuggestions();
        location.hash = `#/search?q=${encodeURIComponent(q)}`;
      });
    } catch { hideSuggestions(); }
  }, 280);
});
$('#search-input').addEventListener('blur', () => setTimeout(hideSuggestions, 180));
$('#search-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  hideSuggestions();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

/* ============================ views ============================ */

async function renderHome() {
  view().innerHTML = `
    <h1 class="page-title">Discover <small>trending this week</small></h1>
    <section class="row"><h2>🔥 Trending Movies <a href="#/movies">browse all →</a></h2><div id="row-tm">${skeletonGrid(8, true)}</div></section>
    <section class="row"><h2>📺 Trending Series <a href="#/series">browse all →</a></h2><div id="row-tt">${skeletonGrid(8, true)}</div></section>
    <section class="row"><h2>🎬 Coming Soon <a href="#/upcoming">see all →</a></h2><div id="row-up">${skeletonGrid(8, true)}</div></section>`;
  const fill = async (sel, promise) => {
    try {
      const items = (await promise).slice(0, 15);
      const box = $(sel);
      if (!box || !box.isConnected) return;
      box.innerHTML = `<div class="hscroll">${items.map(cardHTML).join('')}</div>`;
      bindCards(box);
      enrich(items, box.querySelector('.hscroll'));
    } catch { /* row stays skeleton on error */ }
  };
  await Promise.all([
    fill('#row-tm', api('/api/trending?type=movie')),
    fill('#row-tt', api('/api/trending?type=tv')),
    fill('#row-up', api('/api/upcoming?type=movie'))
  ]);
}

async function renderBrowse(kind) {
  const type = kind === 'series' ? 'tv' : 'movie';
  const f = state.browse[kind];
  const sh = state.shared;
  const effSort = (kind !== 'series' && sh.sort === 'seasons') ? 'popularity' : sh.sort;
  view().innerHTML = `<h1 class="page-title">${kind === 'series' ? 'Series' : 'Movies'} <small>loading…</small></h1>${skeletonGrid(14)}`;

  if (!state.genres[type].length) {
    try { state.genres[type] = await api(`/api/genres?type=${type}`); } catch { /* chips still work */ }
  }
  const data = await api(`/api/browse?type=${type}&service=${sh.service}&genre=${f.genre}&sort=${effSort}&page=${f.page}`);
  const chips = [{ slug: '', name: 'All services' }, ...state.services]
    .map(s => `<button class="chip ${sh.service === s.slug ? 'active' : ''}" data-svc="${s.slug}">${esc(s.name)}</button>`).join('');
  const genreOpts = ['<option value="">All genres</option>',
    ...state.genres[type].map(g => `<option value="${g.id}" ${String(f.genre) === String(g.id) ? 'selected' : ''}>${esc(g.name)}</option>`)].join('');
  view().innerHTML = `
    <h1 class="page-title">${kind === 'series' ? 'Series' : 'Movies'} <small>${sh.service ? 'on ' + esc(svcName(sh.service)) : 'across all major services'}</small></h1>
    <div class="filterbar">
      <div class="chips">${chips}</div>
      <div class="selects">
        <select id="sel-genre" aria-label="Genre">${genreOpts}</select>
        <select id="sel-sort" aria-label="Sort by">
          <option value="popularity" ${sh.sort === 'popularity' ? 'selected' : ''}>Sort: Popularity</option>
          <option value="rating" ${sh.sort === 'rating' ? 'selected' : ''}>Sort: IMDB rating</option>
          <option value="date" ${sh.sort === 'date' ? 'selected' : ''}>Sort: Newest</option>
          <option value="title" ${sh.sort === 'title' ? 'selected' : ''}>Sort: A–Z</option>
          ${kind === 'series' ? `<option value="seasons" ${sh.sort === 'seasons' ? 'selected' : ''}>Sort: Seasons</option>` : ''}
        </select>
      </div>
    </div>
    ${data.results.length
      ? `<div class="grid" id="browse-grid">${data.results.map(cardHTML).join('')}</div>`
      : `<div class="empty"><span class="big">🕳️</span>Nothing matched those filters.</div>`}
    <div class="pager" id="pager">
      <button class="btn-outline" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${data.page} of ${data.totalPages}</span>
      <button class="btn-outline" id="pg-next" ${f.page >= data.totalPages ? 'disabled' : ''}>Next →</button>
      ${data.totalPages > 1 ? '<button class="btn-outline" id="pg-all">Show all</button>' : ''}
    </div>`;
  bindCards(view());
  const resort = (effSort === 'rating' || effSort === 'seasons') ? effSort : null;
  enrich(data.results, $('#browse-grid'), resort);

  view().querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    sh.service = c.dataset.svc;
    state.browse.movies.page = state.browse.series.page = 1;
    savePrefs(); renderBrowse(kind);
  }));
  $('#sel-genre').addEventListener('change', e => { f.genre = e.target.value; f.page = 1; renderBrowse(kind); });
  $('#sel-sort').addEventListener('change', e => {
    sh.sort = e.target.value;
    state.browse.movies.page = state.browse.series.page = 1;
    savePrefs(); renderBrowse(kind);
  });
  $('#pg-prev').addEventListener('click', () => { f.page--; renderBrowse(kind); window.scrollTo(0, 0); });
  $('#pg-next').addEventListener('click', () => { f.page++; renderBrowse(kind); window.scrollTo(0, 0); });
  const allBtn = $('#pg-all');
  if (allBtn) allBtn.addEventListener('click', async () => {
    const MAX_TITLES = 200;
    allBtn.disabled = true;
    $('#pg-prev').disabled = $('#pg-next').disabled = true;
    let all = [...data.results];
    let page = data.page;
    try {
      while (page < data.totalPages && all.length < MAX_TITLES) {
        allBtn.textContent = `Loading… ${all.length} titles`;
        page += 1;
        const more = await api(`/api/browse?type=${type}&service=${sh.service}&genre=${f.genre}&sort=${effSort}&page=${page}`);
        if (!more.results.length) break;
        all = all.concat(more.results);
      }
    } catch { /* show what we have */ }
    const grid = $('#browse-grid');
    if (!grid) return;
    grid.innerHTML = all.map(cardHTML).join('');
    bindCards(grid);
    const truncated = page < data.totalPages;
    $('#pager').innerHTML = `<span>Showing ${all.length} titles${truncated ? ' (first ' + MAX_TITLES + ' — narrow filters to dig deeper)' : " — that's everything"}</span>`;
    enrich(all, grid, resort);
    window.scrollTo(0, 0);
  });
}

async function renderUpcoming() {
  view().innerHTML = `<h1 class="page-title">Coming Soon</h1>${skeletonGrid(14)}`;
  let [movies, series] = await Promise.all([api('/api/upcoming?type=movie'), api('/api/upcoming?type=tv')]);
  movies = sortList(movies, state.upSort);
  series = sortList(series, state.upSort);
  view().innerHTML = `
    <h1 class="page-title">Coming Soon</h1>
    <div class="filterbar"><div class="selects" style="margin-left:0">
      <select id="up-sort" aria-label="Sort upcoming">
        <option value="" ${!state.upSort ? 'selected' : ''}>Sort: Release order</option>
        <option value="rating" ${state.upSort === 'rating' ? 'selected' : ''}>Sort: IMDB rating</option>
        <option value="seasons" ${state.upSort === 'seasons' ? 'selected' : ''}>Sort: Seasons (series)</option>
        <option value="title" ${state.upSort === 'title' ? 'selected' : ''}>Sort: A–Z</option>
      </select>
    </div></div>
    <section class="row"><h2>🎬 Movies</h2><div class="grid" id="up-movies">${movies.map(cardHTML).join('') || '<p class="empty">Nothing found.</p>'}</div></section>
    <section class="row"><h2>📺 Series</h2><div class="grid" id="up-series">${series.map(cardHTML).join('') || '<p class="empty">Nothing found.</p>'}</div></section>`;
  bindCards(view());
  enrich(movies, $('#up-movies'), state.upSort || null);
  enrich(series, $('#up-series'), state.upSort || null);
  $('#up-sort').addEventListener('change', e => { state.upSort = e.target.value; renderUpcoming(); });
}

async function renderSearch(q) {
  view().innerHTML = `<h1 class="page-title">Results for “${esc(q)}”</h1>${skeletonGrid(10)}`;
  const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
  const movies = sortList(data.results.filter(x => x.mediaType === 'movie'), state.searchSort);
  const series = sortList(data.results.filter(x => x.mediaType === 'tv'), state.searchSort);
  view().innerHTML = `
    <h1 class="page-title">Results for “${esc(q)}” <small>${data.results.length} titles</small></h1>
    <div class="filterbar"><div class="selects" style="margin-left:0">
      <select id="search-sort" aria-label="Sort results">
        <option value="" ${!state.searchSort ? 'selected' : ''}>Sort: Relevance</option>
        <option value="rating" ${state.searchSort === 'rating' ? 'selected' : ''}>Sort: IMDB rating</option>
        <option value="seasons" ${state.searchSort === 'seasons' ? 'selected' : ''}>Sort: Seasons (series)</option>
        <option value="year" ${state.searchSort === 'year' ? 'selected' : ''}>Sort: Year</option>
        <option value="title" ${state.searchSort === 'title' ? 'selected' : ''}>Sort: A–Z</option>
      </select>
    </div></div>
    ${movies.length ? `<section class="row"><h2>🎬 Movies</h2><div class="grid" id="sr-movies">${movies.map(cardHTML).join('')}</div></section>` : ''}
    ${series.length ? `<section class="row"><h2>📺 Series</h2><div class="grid" id="sr-series">${series.map(cardHTML).join('')}</div></section>` : ''}
    ${!data.results.length ? '<div class="empty"><span class="big">🔍</span>No movies or series matched.</div>' : ''}`;
  bindCards(view());
  enrich(movies, $('#sr-movies'), state.searchSort || null);
  enrich(series, $('#sr-series'), state.searchSort || null);
  $('#search-sort').addEventListener('change', e => { state.searchSort = e.target.value; renderSearch(q); });
}

async function renderTitle(type, id) {
  view().innerHTML = skeletonGrid(7);
  const d = await api(`/api/title/${type}/${id}`);
  const key = `${d.mediaType}:${d.id}`;
  const on = state.watchKeys.has(key);
  const facts = [
    `<span class="imdb">★ ${d.imdbRating ? d.imdbRating.toFixed(1) + ' IMDb' : (d.rating ? d.rating.toFixed(1) + ' TMDB' : 'Unrated')}</span>`,
    d.certification ? `<span class="cert">${esc(d.certification)}</span>` : '',
    esc(d.year || ''),
    d.runtime ? `${d.runtime} min` : '',
    d.seasons ? `${d.seasons} season${d.seasons > 1 ? 's' : ''} · ${d.episodes} eps` : '',
    `<span>${d.mediaType === 'tv' ? 'TV Series' : 'Movie'}</span>`
  ].filter(Boolean).join(' <span>·</span> ');
  view().innerHTML = `
    <div class="hero">
      ${d.backdrop ? `<img class="backdrop" src="${IMG}/w1280${d.backdrop}" alt="">` : '<div class="backdrop"></div>'}
      <div class="hero-inner">
        ${d.poster ? `<img class="poster-lg" src="${IMG}/w342${d.poster}" alt="${esc(d.title)} poster">` : ''}
        <div>
          <h1>${esc(d.title)}</h1>
          ${d.tagline ? `<p style="color:var(--muted);font-style:italic;margin:0 0 8px">${esc(d.tagline)}</p>` : ''}
          <div class="facts">${facts}</div>
          <div class="pillrow">${d.genres.map(g => `<span class="pill">${esc(g.name)}</span>`).join('')}</div>
          <div class="btnrow">
            <button class="btn-solid ${on ? 'watch-on' : ''}" id="d-watch">${on ? '★ In your watchlist' : '☆ Add to watchlist'}</button>
            ${d.trailerKey ? `<a class="btn-outline" href="https://www.youtube.com/watch?v=${d.trailerKey}" target="_blank" rel="noopener">▶ Trailer</a>` : ''}
            ${d.imdbId ? `<a class="btn-outline" href="https://www.imdb.com/title/${d.imdbId}/" target="_blank" rel="noopener">IMDb ↗</a>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <div>
        <h3>Overview</h3>
        <p class="overview">${esc(d.overview) || 'No overview available.'}</p>
        <h3>Cast</h3>
        <div class="castgrid">${d.cast.map(c => `
          <div class="castcard">
            ${c.profile ? `<img loading="lazy" src="${IMG}/w185${c.profile}" alt="${esc(c.name)}">` : '<div class="noface">👤</div>'}
            <b>${esc(c.name)}</b>${esc(c.character || '')}
          </div>`).join('') || '<p class="empty">No cast info.</p>'}
        </div>
      </div>
      <div>
        <h3>Where to watch</h3>
        <div class="pillrow">${d.services.length
          ? d.services.map(s => `<span class="pill svc">${esc(svcName(s))}</span>`).join('')
          : '<span style="color:var(--muted);font-size:14px">Not currently on a major subscription service in your region.</span>'}</div>
        <h3>Parent guide</h3>
        <dl class="guide">
          <dt>Certification</dt><dd>${esc(d.certification || 'Not rated / unknown')}</dd>
          <dt>Content signals</dt><dd>${d.keywords.length ? esc(d.keywords.slice(0, 10).join(', ')) : 'No content keywords available.'}</dd>
          ${d.imdbId ? `<dt>Full guide</dt><dd><a href="https://www.imdb.com/title/${d.imdbId}/parentalguide" target="_blank" rel="noopener">IMDb Parents Guide ↗</a></dd>` : ''}
        </dl>
      </div>
    </div>`;
  $('#d-watch').addEventListener('click', async () => {
    await toggleWatch({ id: d.id, mediaType: d.mediaType, title: d.title, poster: d.poster, rating: d.imdbRating || d.rating, year: d.year, services: d.services, seasons: d.seasons });
    if (state.user) renderTitle(type, id);
  });
}

async function renderWatchlist() {
  if (state.authKnown && !state.user) {
    view().innerHTML = `
      <div class="cta-box">
        <span class="big">⭐</span>
        <h2 style="margin:0 0 10px">Your watchlist lives here</h2>
        <p>Sign in (or create a free account) to star movies and series.<br>Your list syncs to every device you sign in from.</p>
        <button class="btn-primary" id="wl-signin" style="width:auto;padding:12px 30px">Sign in / Create account</button>
      </div>`;
    $('#wl-signin').addEventListener('click', () => openAuth('login'));
    return;
  }
  view().innerHTML = skeletonGrid(8);
  let list = await api('/api/watchlist');
  state.watchKeys = new Set(list.map(x => x.key));
  if (state.wlType !== 'all') list = list.filter(x => x.mediaType === state.wlType);
  const sorters = {
    added: (a, b) => new Date(b.addedAt) - new Date(a.addedAt),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    title: (a, b) => a.title.localeCompare(b.title),
    year: (a, b) => (b.year || '').localeCompare(a.year || ''),
    seasons: (a, b) => (b.seasons || 0) - (a.seasons || 0),
    type: (a, b) => a.mediaType.localeCompare(b.mediaType) || (b.rating || 0) - (a.rating || 0),
    service: (a, b) => ((a.services || [])[0] || 'zzz').localeCompare((b.services || [])[0] || 'zzz') || (b.rating || 0) - (a.rating || 0)
  };
  list.sort(sorters[state.wlSort] || sorters.added);
  const groupByService = state.wlSort === 'service';
  let body;
  if (!list.length) {
    body = `<div class="empty"><span class="big">⭐</span>Your watchlist is empty.<br>Tap the ☆ on any movie or series to save it here — it syncs to all your devices.</div>`;
  } else if (groupByService) {
    const groups = {};
    for (const x of list) {
      const g = (x.services || [])[0] ? svcName(x.services[0]) : 'Other / not on a major service';
      (groups[g] = groups[g] || []).push(x);
    }
    body = Object.entries(groups).map(([g, items]) =>
      `<section class="row"><h2>${esc(g)}</h2><div class="grid">${items.map(cardHTML).join('')}</div></section>`).join('');
  } else {
    body = `<div class="grid">${list.map(cardHTML).join('')}</div>`;
  }
  view().innerHTML = `
    <h1 class="page-title">★ Watchlist <small>${list.length} title${list.length === 1 ? '' : 's'}</small></h1>
    <div class="filterbar">
      <div class="chips">
        <button class="chip ${state.wlType === 'all' ? 'active' : ''}" data-t="all">All</button>
        <button class="chip ${state.wlType === 'movie' ? 'active' : ''}" data-t="movie">Movies</button>
        <button class="chip ${state.wlType === 'tv' ? 'active' : ''}" data-t="tv">Series</button>
      </div>
      <div class="selects">
        <select id="wl-sort" aria-label="Sort watchlist">
          <option value="added" ${state.wlSort === 'added' ? 'selected' : ''}>Sort: Recently added</option>
          <option value="rating" ${state.wlSort === 'rating' ? 'selected' : ''}>Sort: IMDB rating</option>
          <option value="service" ${state.wlSort === 'service' ? 'selected' : ''}>Sort: Streaming service</option>
          <option value="type" ${state.wlSort === 'type' ? 'selected' : ''}>Sort: Type (movies/series)</option>
          <option value="title" ${state.wlSort === 'title' ? 'selected' : ''}>Sort: A–Z</option>
          <option value="year" ${state.wlSort === 'year' ? 'selected' : ''}>Sort: Year</option>
          <option value="seasons" ${state.wlSort === 'seasons' ? 'selected' : ''}>Sort: Seasons</option>
        </select>
      </div>
    </div>
    ${body}`;
  bindCards(view());
  view().querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => { state.wlType = c.dataset.t; renderWatchlist(); }));
  $('#wl-sort').addEventListener('change', e => { state.wlSort = e.target.value; renderWatchlist(); });
}

/* ============================ router + boot ============================ */

function currentRoute() { return location.hash || '#/home'; }
function setActiveNav(name) {
  document.querySelectorAll('#mainnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}
async function route() {
  const hash = currentRoute();
  try {
    if (hash.startsWith('#/movies')) { setActiveNav('movies'); await renderBrowse('movies'); }
    else if (hash.startsWith('#/series')) { setActiveNav('series'); await renderBrowse('series'); }
    else if (hash.startsWith('#/upcoming')) { setActiveNav('upcoming'); await renderUpcoming(); }
    else if (hash.startsWith('#/watchlist')) { setActiveNav('watchlist'); await renderWatchlist(); }
    else if (hash.startsWith('#/title/')) { setActiveNav(''); const [, , type, id] = hash.split('/'); await renderTitle(type, id.split('?')[0]); window.scrollTo(0, 0); }
    else if (hash.startsWith('#/search')) { setActiveNav(''); const q = new URLSearchParams(hash.split('?')[1] || '').get('q') || ''; await renderSearch(q); }
    else { setActiveNav('home'); await renderHome(); }
  } catch (err) {
    view().innerHTML = `<div class="empty"><span class="big">⚠️</span>${esc(err.message)}<br><br><button class="btn-outline" onclick="location.reload()">Reload</button></div>`;
  }
}
window.addEventListener('hashchange', route);

(async function boot() {
  route(); // render immediately — no login wall
  api('/api/services').then(s => { state.services = s; }).catch(() => {});
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
  } catch { state.user = null; }
  state.authKnown = true;
  refreshHeader();
  if (state.user) {
    await loadWatchlistKeys();
    route(); // re-render with stars filled in
  } else if (currentRoute().startsWith('#/watchlist')) {
    route(); // show the sign-in CTA now that auth state is known
  }
})();

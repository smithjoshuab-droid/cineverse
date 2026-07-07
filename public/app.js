'use strict';
/* CineVerse SPA — hash router, movies + series, filters, watchlist. */

const IMG = 'https://image.tmdb.org/t/p';
const $ = sel => document.querySelector(sel);
const view = () => $('#view');

const state = {
  user: null,
  services: [],                    // [{slug,name}]
  genres: { movie: [], tv: [] },   // fetched once per type
  watchKeys: new Set(),            // "movie:123"
  // service + sort are SHARED between Movies and Series (and remembered across visits);
  // genre and page stay per-type because TMDB movie/tv genre lists differ.
  shared: (() => {
    try { return { service: '', sort: 'popularity', ...JSON.parse(localStorage.getItem('cv_prefs') || '{}') }; }
    catch { return { service: '', sort: 'popularity' }; }
  })(),
  browse: {
    movies: { genre: '', page: 1 },
    series: { genre: '', page: 1 }
  },
  wlSort: 'added',
  wlType: 'all',
  searchSort: '',
  upSort: ''
};

// ---------- tiny helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
function spinner() { view().innerHTML = '<div class="spinner">Loading…</div>'; }
function sortList(list, mode) {
  const by = {
    rating: (x, y) => ((y.imdbRating ?? y.rating ?? 0) - (x.imdbRating ?? x.rating ?? 0)),
    seasons: (x, y) => ((y.seasons || 0) - (x.seasons || 0)),
    title: (x, y) => x.title.localeCompare(y.title),
    year: (x, y) => (y.year || '').localeCompare(x.year || '')
  }[mode];
  return by ? [...list].sort(by) : list;
}
function savePrefs() { try { localStorage.setItem('cv_prefs', JSON.stringify(state.shared)); } catch { /* private mode */ } }
function svcName(slug) { const s = state.services.find(x => x.slug === slug); return s ? s.name : slug; }

// ---------- auth ----------
let authMode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
}
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = state.user.name || state.user.email;
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
async function enterApp() {
  await loadWatchlistKeys();
  showApp();
  location.hash = location.hash && location.hash !== '#' ? location.hash : '#/home';
  route();
}
$('#auth-switch-link').addEventListener('click', e => { e.preventDefault(); setAuthMode(authMode === 'login' ? 'signup' : 'login'); });
$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  let path = 'login';
  const payload = { email: $('#auth-email').value };
  if (authMode === 'signup') {
    path = 'signup';
    payload.password = $('#auth-password').value;
    payload.name = $('#auth-name').value;
  } else if (authMode === 'reset') {
    path = 'reset';
    payload.newPassword = $('#auth-password').value;
    payload.recoveryCode = $('#auth-code').value;
  } else {
    payload.password = $('#auth-password').value;
  }
  try {
    const data = await api(`/api/auth/${path}`, { method: 'POST', body: JSON.stringify(payload) });
    state.user = data.user;
    if (data.recoveryCode) {
      // show the (new) recovery code once — user confirms before entering the app
      $('#auth-form').classList.add('hidden');
      document.querySelector('.auth-switch').classList.add('hidden');
      $('#recovery-code').textContent = data.recoveryCode;
      $('#recovery-box').classList.remove('hidden');
    } else {
      await enterApp();
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
  await enterApp();
});
$('#auth-forgot-link').addEventListener('click', e => { e.preventDefault(); setAuthMode('reset'); });
$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.watchKeys.clear();
  showAuth();
});

async function loadWatchlistKeys() {
  try {
    const list = await api('/api/watchlist');
    state.watchKeys = new Set(list.map(x => x.key));
  } catch { state.watchKeys = new Set(); }
}

// ---------- watchlist toggle ----------
async function toggleWatch(item, btn) {
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

// ---------- card rendering ----------
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

// ---------- HOME ----------
async function renderHome() {
  spinner();
  const [tm, tt, up] = await Promise.all([
    api('/api/trending?type=movie'),
    api('/api/trending?type=tv'),
    api('/api/upcoming?type=movie')
  ]);
  view().innerHTML = `
    <h1 class="page-title">Discover <small>trending this week</small></h1>
    <section class="row"><h2>🔥 Trending Movies <a href="#/movies">browse all →</a></h2>
      <div class="hscroll">${tm.slice(0, 15).map(cardHTML).join('')}</div></section>
    <section class="row"><h2>📺 Trending Series <a href="#/series">browse all →</a></h2>
      <div class="hscroll">${tt.slice(0, 15).map(cardHTML).join('')}</div></section>
    <section class="row"><h2>🎬 Coming Soon <a href="#/upcoming">see all →</a></h2>
      <div class="hscroll">${up.slice(0, 15).map(cardHTML).join('')}</div></section>`;
  bindCards(view());
}

// ---------- BROWSE (movies / series) ----------
async function renderBrowse(kind) {
  const type = kind === 'series' ? 'tv' : 'movie';
  const f = state.browse[kind];
  const sh = state.shared;
  // 'seasons' sort only applies to series; movies quietly use popularity
  const effSort = (kind !== 'series' && sh.sort === 'seasons') ? 'popularity' : sh.sort;
  spinner();
  if (!state.genres[type].length) {
    state.genres[type] = await api(`/api/genres?type=${type}`);
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
      ? `<div class="grid">${data.results.map(cardHTML).join('')}</div>`
      : `<div class="empty"><span class="big">🕳️</span>Nothing matched those filters.</div>`}
    <div class="pager" id="pager">
      <button class="btn-outline" id="pg-prev" ${f.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${data.page} of ${data.totalPages}</span>
      <button class="btn-outline" id="pg-next" ${f.page >= data.totalPages ? 'disabled' : ''}>Next →</button>
      ${data.totalPages > 1 ? '<button class="btn-outline" id="pg-all">Show all</button>' : ''}
    </div>`;
  bindCards(view());
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
    const MAX_TITLES = 200; // keep the page usable; narrow filters to see deeper
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
    if (effSort === 'rating') all = sortList(all, 'rating');
    if (effSort === 'seasons') all = sortList(all, 'seasons');
    const grid = view().querySelector('.grid');
    if (grid) { grid.innerHTML = all.map(cardHTML).join(''); bindCards(grid); }
    const truncated = page < data.totalPages;
    $('#pager').innerHTML = `<span>Showing ${all.length} titles${truncated ? ' (first ' + MAX_TITLES + ' — narrow filters to dig deeper)' : ' — that\'s everything'}</span>`;
    window.scrollTo(0, 0);
  });
}

// ---------- UPCOMING ----------
async function renderUpcoming() {
  spinner();
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
    <section class="row"><h2>🎬 Movies</h2><div class="grid">${movies.map(cardHTML).join('') || '<p class="empty">Nothing found.</p>'}</div></section>
    <section class="row"><h2>📺 Series</h2><div class="grid">${series.map(cardHTML).join('') || '<p class="empty">Nothing found.</p>'}</div></section>`;
  bindCards(view());
  $('#up-sort').addEventListener('change', e => { state.upSort = e.target.value; renderUpcoming(); });
}

// ---------- SEARCH ----------
async function renderSearch(q) {
  spinner();
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
    ${movies.length ? `<section class="row"><h2>🎬 Movies</h2><div class="grid">${movies.map(cardHTML).join('')}</div></section>` : ''}
    ${series.length ? `<section class="row"><h2>📺 Series</h2><div class="grid">${series.map(cardHTML).join('')}</div></section>` : ''}
    ${!data.results.length ? '<div class="empty"><span class="big">🔍</span>No movies or series matched.</div>' : ''}`;
  bindCards(view());
  $('#search-sort').addEventListener('change', e => { state.searchSort = e.target.value; renderSearch(q); });
}
$('#search-form').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
});

// ---------- DETAILS ----------
async function renderTitle(type, id) {
  spinner();
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
    renderTitle(type, id);
  });
}

// ---------- WATCHLIST ----------
async function renderWatchlist() {
  spinner();
  let list = await api('/api/watchlist');
  state.watchKeys = new Set(list.map(x => x.key));
  // filter by type
  if (state.wlType !== 'all') list = list.filter(x => x.mediaType === state.wlType);
  // sort
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

// ---------- router ----------
function currentRoute() { return location.hash || '#/home'; }
function setActiveNav(name) {
  document.querySelectorAll('#mainnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
}
async function route() {
  if (!state.user) return;
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

// ---------- boot ----------
(async function boot() {
  try { state.services = await api('/api/services'); } catch { state.services = []; }
  try {
    const { user } = await api('/api/auth/me');
    state.user = user;
  } catch { state.user = null; }
  if (state.user) {
    await loadWatchlistKeys();
    showApp();
    route();
  } else {
    setAuthMode('login');
    showAuth();
  }
})();

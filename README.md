# CineVerse

A streaming-discovery web app for **movies and TV series**. One watchlist across every
major service, filterable by service and genre, sortable by IMDB rating — synced to
any device you sign in from.

![Cinematic Noir theme](https://img.shields.io/badge/theme-cinematic_noir-8b5cf6) ![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-success)

## What it does

- **Movies AND series** — dedicated Movies and Series browse pages, plus mixed search and trending rows.
- **Sign up & sign in** — bcrypt-hashed passwords, signed-cookie sessions, file-backed user store.
- **Browse across** Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Peacock, and Paramount+.
- **Filter by streaming service** (chips along the top) and **by genre**.
- **Sort by IMDB rating, popularity, release date, or A–Z** on every browse page.
- **Watchlist sorting** — by type (movies/series), streaming service (grouped), IMDB rating, title, year, or date added.
- **Coming Soon** — upcoming movies and series for your region.
- **Star ★ to add to your watchlist** — from grids, search results, and detail pages. Syncs everywhere.
- **Detail pages** — poster, backdrop, overview, cast, where to watch, trailer, certification + parent-guide info, real IMDb rating (via OMDb) with IMDb deep link.

## Setup

### 1. Get a free TMDB API key

1. Make a free TMDB account → https://www.themoviedb.org/signup
2. **Settings → API** → request a key (the "Developer" tier is instant).
3. Copy your **API Read Access Token (v4)** _or_ **API Key (v3)**. Either works — auto-detected.

Optionally grab a free OMDb key (https://www.omdbapi.com/apikey.aspx) for official IMDb ratings on detail pages; without it the app shows TMDB scores.

### 2. Install and run

```bash
cd streaming-app
cp .env.example .env
# open .env and paste your key into TMDB_API_KEY=
npm install
npm start
```

Then open **http://localhost:3000**. First time? Click **Create an account**.

### 3. Environment variables

| Variable         | Default     | Notes                                                                 |
|------------------|-------------|-----------------------------------------------------------------------|
| `TMDB_API_KEY`   | _required_  | v3 key (32 chars) or v4 read access token (JWT). Auto-detected.       |
| `OMDB_API_KEY`   | _optional_  | Enables real IMDb ratings on detail pages.                            |
| `SESSION_SECRET` | _generated_ | Set to keep sessions valid across restarts.                           |
| `PORT`           | `3000`      | HTTP port.                                                            |
| `TMDB_REGION`    | `US`        | ISO country code for streaming-provider availability.                 |

## Project layout

```
streaming-app/
├── server.js           # Express server, routes, session handling
├── lib/
│   ├── tmdb.js         # TMDB API wrapper (cached, movie + TV, providers)
│   └── store.js        # File-backed user + watchlist store
├── public/
│   ├── index.html      # SPA shell — auth, browse, details, watchlist
│   ├── app.js          # Hash router, filters, sorting, watchlist toggle
│   └── styles.css      # Cinematic Noir theme (responsive, mobile-ready)
├── data/               # Created at runtime — users.json + watchlists.json
├── render.yaml         # One-click Render deploy config
├── .env.example
└── package.json
```

## Routes

```
#/home              → trending movies, trending series, coming soon
#/movies            → movie grid (service chips, genre + sort selects)
#/series            → series grid (same filters)
#/upcoming          → coming-soon movies + series
#/watchlist         → your starred titles (sort by type/service/rating/…)
#/title/:type/:id   → detail page (movie or tv)
#/search?q=…        → mixed search, grouped by movies / series
```

## Deployment

See **DEPLOY.md** for the click-by-click guide to hosting this free on Render with a
public URL that works on any device.

## Limitations (honest notes)

- **"IMDB rating" in grids is TMDB's `vote_average`** — it correlates closely with IMDb. Detail pages show the official IMDb rating when an OMDb key is configured.
- **Parent guide is a summary** — certification + content keywords, with a one-click link to the full IMDb Parents Guide.
- **Auth is demo-grade** — real bcrypt + signed cookies, but a JSON-file store. On Render's free tier the disk is ephemeral: accounts/watchlists reset when the service redeploys or restarts. Fine for personal use; swap `lib/store.js` for a database (or add a Render disk) to make it durable.

## Tech stack

Node 18+ / Express / bcryptjs / cookie-parser · Vanilla-JS hash-routed SPA · TMDB v3 API (10-min cache) · OMDb for IMDb ratings.

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

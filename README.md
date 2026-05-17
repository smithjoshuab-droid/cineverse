# CinemaVerse

A streaming-discovery web app. One watchlist across every major service, filtered
by genre, sorted by rating, with parent-guide info on every movie.

![Cinematic Noir theme](https://img.shields.io/badge/theme-cinematic_noir-8b5cf6) ![Node 18+](https://img.shields.io/badge/node-%E2%89%A518-success)

## What it does

- **Sign up & sign in** — bcrypt-hashed passwords, signed-cookie sessions, file-backed user store.
- **Browse movies** across Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Peacock, and Paramount+.
- **Filter by streaming service** (chips along the top of Discover).
- **Filter by genre** (Action, Drama, Horror, Sci-Fi, Animation, Documentary, …).
- **Sort by IMDB-style rating, popularity, release date, or A–Z title**.
- **Coming Soon** — TMDB's official upcoming feed for your region.
- **Leaving Soon** — older catalog titles still on a service (see [Limitations](#limitations) — TMDB doesn't expose contractual leave dates).
- **Star ★ to add to your watchlist** — works from grids, search results, the watchlist page, and the movie detail page.
- **Movie details** — poster, backdrop, overview, cast, where to watch, trailer, parent guide.

## Setup

### 1. Get a free TMDB API key

Movie data comes from [The Movie Database](https://www.themoviedb.org/) (free for personal use).

1. Make a free TMDB account → https://www.themoviedb.org/signup
2. Go to **Settings → API** → request an API key (the "Developer" tier is instant).
3. Copy your **API Read Access Token (v4)** _or_ your **API Key (v3 auth)**. Either works.

### 2. Install and run

```bash
cd streaming-app
cp .env.example .env
# open .env and paste your key into TMDB_API_KEY=
npm install
npm start
```

Then open **http://localhost:3000**.

First time? Click **Create an account** in the auth card.

### 3. Optional environment variables

| Variable           | Default      | Notes                                                                          |
|--------------------|--------------|--------------------------------------------------------------------------------|
| `TMDB_API_KEY`     | _required_   | v3 key (32 chars) or v4 read access token (long JWT). Auto-detected.           |
| `SESSION_SECRET`   | _generated_  | Set this to keep sessions valid across server restarts.                        |
| `PORT`             | `3000`       | HTTP port.                                                                     |
| `TMDB_REGION`      | `US`         | ISO country code for streaming-provider availability.                          |

## Project layout

```
streaming-app/
├── server.js           # Express server, routes, session handling
├── lib/
│   ├── tmdb.js         # TMDB API wrapper (cached, paginated)
│   └── store.js        # File-backed user + watchlist store
├── public/
│   ├── index.html      # SPA shell — auth, dashboard, details, watchlist
│   ├── app.js          # Hash router, filters, watchlist toggle, details
│   └── styles.css      # Cinematic Noir theme
├── data/               # Created at runtime — users.json + watchlists.json
├── .env.example
├── .gitignore
└── package.json
```

## How it routes

```
#/discover            → home dashboard (recommended / now playing / coming soon)
#/discover (filtered) → grid of results when any filter chip / select is active
#/upcoming            → full coming-soon list
#/leaving             → leaving-soon (approximated)
#/watchlist           → your starred movies
#/movie/:id           → movie detail page
#/search?q=…          → search results (typed in the nav bar)
```

## Limitations

A few honest notes on what isn't possible with free public data:

- **"Leaving Soon" is approximated.** Streaming services don't publish leave dates, and TMDB doesn't expose them. We surface older catalog titles still on a service — the ones most likely to rotate off — but it's a hint, not a guarantee. JustWatch has this data but it's behind a paid partner agreement.
- **Parent guide is a summary, not the full IMDb scoring.** IMDb removed their public API. We construct a parent guide from TMDB's MPAA certification + content keywords, organized into the IMDb-style categories (Sex & Nudity, Violence, Profanity, Substance Use, Frightening Scenes). Every movie page also links to the **full IMDb Parents Guide** for that title — one click to the real thing.
- **"IMDB rating" displayed is TMDB's `vote_average`.** It correlates closely with IMDb's score but isn't identical. The deep link to IMDb on each movie shows the official IMDb rating.
- **Auth is demo-grade.** Real bcrypt hashing, signed cookies — but the user store is a JSON file, not a database. Fine for a personal install. Don't deploy this publicly without swapping `lib/store.js` for SQLite/Postgres.

## Tech stack

- **Backend:** Node 18+, Express, bcryptjs, cookie-parser, dotenv
- **Frontend:** Vanilla JS (no framework), hash-based SPA routing
- **Data:** TMDB v3 REST API (cached 10 min in-memory)
- **Persistence:** JSON files in `data/`

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.

> ![TMDB logo](https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg)

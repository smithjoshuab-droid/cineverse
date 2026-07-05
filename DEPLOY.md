# Deploying CineVerse to Render

This guide gets your CineVerse app on the public internet with a URL you can share between devices. **No technical experience required** — every step is click-by-click.

**Time estimate:** 15–20 minutes. **Cost:** $0 (everything below has free tiers).

## What you'll end up with

- A URL like `https://cineverse-xxxx.onrender.com` that works on any device
- Your account + watchlist sync across phone, laptop, tablet — anywhere you sign in
- Your TMDB and OMDB API keys hidden on the server (never exposed in the browser)

**One quirk to know:** Render's free tier puts the app to sleep after 15 minutes of inactivity. Next visit takes ~30 seconds to wake up, then it's instant.

## Step 1 — Create a GitHub account (skip if you have one)

1. Go to **https://github.com/signup**, enter email → password → username, verify your email.

## Step 2 — Put the code on GitHub

1. Sign in to GitHub → **+** (top-right) → **New repository**
2. Name it `cineverse`, Public, leave defaults, **Create repository**
3. Click **uploading an existing file**
4. Drag the entire `streaming-app` folder contents in (including `lib/` and `public/`)
   - Do NOT include `data/` or `node_modules/` (the `.gitignore` keeps them out with git uploads)
5. **Commit changes**

## Step 3 — Create a Render account

1. Go to **https://render.com** → **Get Started** → sign up with **GitHub** → authorize.

## Step 4 — Create the web service

1. Dashboard → **New +** → **Web Service** → **Connect** your `cineverse` repo
2. Most fields auto-fill from `render.yaml`. Verify: Runtime `Node`, Build `npm install`, Start `npm start`, Instance Type **Free**
3. Environment variables:
   - `TMDB_API_KEY` — your TMDB key
   - `OMDB_API_KEY` — your OMDB key (optional; enables real IMDb ratings)
   - `SESSION_SECRET` — Render auto-fills
   - `NODE_ENV=production`, `TMDB_REGION=US`
4. **Create Web Service**

## Step 5 — Wait for the build (3–5 min)

When logs show `Your service is live 🎉` / `CineVerse running`, you're done. Your URL is at the top of the page.

## Step 6 — Visit your URL on any device

Create an account, sign in — same email + password works everywhere and your watchlist syncs.

- iOS Safari: **Share → Add to Home Screen** for an app-like icon
- Android Chrome: **⋮ → Add to Home screen**

## Updating later

Edit or re-upload files on GitHub — Render auto-redeploys in a minute or two. URL stays the same.

## Troubleshooting

- **Build failed / "Cannot find module"** — a file didn't upload; re-upload with `lib/` and `public/` included.
- **App loads but nothing shows** — TMDB key missing/wrong: Render → your service → Environment → fix → save.
- **First visit each day is slow** — free-tier cold start; wait ~30s.
- **Accounts disappeared after a redeploy** — free-tier disk is ephemeral (JSON-file store). Add a Render disk or a database for durability.

## Cost / quota summary

| Service | Free tier | If exceeded |
|---------|-----------|-------------|
| Render  | 750 hrs/month (one app 24/7) | Stops until next month |
| TMDB    | ~unlimited (50 req/s) | Brief rate-limit errors, auto-recover |
| OMDB    | 1,000 req/day | App falls back to TMDB ratings |
| GitHub  | Unlimited public repos | n/a |

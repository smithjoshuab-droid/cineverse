# Deploying CineVerse to Render

This guide gets your CineVerse app on the public internet with a URL you can share between devices. **No technical experience required** — every step is click-by-click.

**Time estimate:** 15–20 minutes.
**Cost:** $0 (everything below has free tiers).

---

## What you'll end up with

- A URL like `https://cineverse-xxxx.onrender.com` that works on any device
- Your account + watchlist sync across phone, laptop, tablet — anywhere you sign in
- Your TMDB and OMDB API keys hidden on the server (never exposed in the browser)

**One quirk to know:** Render's free tier puts the app to sleep after 15 minutes of inactivity. Next time you visit, it takes ~30 seconds to wake up before the page loads. After that it's instant. Fine for a personal app you check a few times a day.

---

## Step 1 — Create a GitHub account (skip if you have one)

Render reads your code from GitHub. You need a free account.

1. Go to **https://github.com/signup**
2. Enter your email → choose a password → pick a username (anything)
3. Verify your email when GitHub sends you the code
4. You're done — no need to do anything else on GitHub yet

---

## Step 2 — Put the code on GitHub

1. Sign in to GitHub
2. Click the **+** in the top-right → **New repository**
3. Fill in:
   - **Repository name:** `cineverse` (or anything you like)
   - **Public** or **Private** — either works. **Public** is simpler.
   - Leave everything else at defaults. **Don't** check "Add a README."
4. Click **Create repository**
5. On the next page, click **uploading an existing file** (it's a small link in the middle of the page)
6. **Drag the entire `streaming-app` folder** from File Explorer onto the upload area. GitHub will pull in every file inside it (including the `lib/` and `public/` subfolders) automatically.
   - If your browser only accepts individual files, open the `streaming-app` folder, select all files (Ctrl+A), and drag them in instead.
   - **Important:** make sure you do NOT include the `data/` folder if it has any test users in it, and do NOT include `node_modules/` if it exists. The included `.gitignore` should keep both out automatically.
7. Scroll down — under "Commit changes" leave the default message. Click **Commit changes**
8. You should now see your files (`server.js`, `package.json`, `lib/`, `public/`, etc.) on the repo page

---

## Step 3 — Create a Render account

1. Go to **https://render.com**
2. Click **Get Started** (or **Sign Up**)
3. Click **GitHub** to sign up using your GitHub account (fastest path — no separate password)
4. Authorize Render to read your GitHub repos when it asks. You can limit it to just the `cineverse` repo if you prefer.

---

## Step 4 — Create the web service

1. From your Render dashboard, click **New +** → **Web Service**
2. Find your `cineverse` repository in the list and click **Connect** next to it
3. On the configuration page, most fields are already filled in correctly because of the `render.yaml` file in your repo. Verify:
   - **Name:** `cineverse` (you can change this — it becomes part of your URL)
   - **Region:** pick the one closest to you (e.g., `Oregon (US West)` or `Ohio (US East)`)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free** (very important — make sure this is selected)
4. Scroll down to **Environment Variables**. You should see slots for:
   - `TMDB_API_KEY` — paste your TMDB key here (the 32-character one, e.g., `84675befbfa2005fe07e35c138a0ccd6`)
   - `OMDB_API_KEY` — paste your OMDB key here (e.g., `a497b47c`)
   - `SESSION_SECRET` — leave this alone, Render auto-fills with a random value
   - `NODE_ENV` — already set to `production`
   - `TMDB_REGION` — already set to `US`
5. Click **Create Web Service**

---

## Step 5 — Wait for the build

Render now downloads your code, runs `npm install`, and starts the server. This takes 3–5 minutes the first time.

You'll see a live log scrolling. When you see something like:

```
==> Your service is live 🎉
CineVerse running at http://localhost:10000
```

…you're done.

Your URL is shown at the top of the page, like `https://cineverse-xxxx.onrender.com`.

---

## Step 6 — Visit your URL

Open the URL in any browser, on any device. Click **Create an account**, sign up, and you're in. The same email + password works on every device, and your watchlist syncs everywhere.

**To bookmark it:** open the URL, then press `Ctrl+D` (or `Cmd+D` on Mac) to save a bookmark.

**To add it to your phone home screen:**
- iOS Safari: tap **Share** → **Add to Home Screen**
- Android Chrome: tap the menu (⋮) → **Add to Home screen**

You'll get an icon that opens the app like a native app.

---

## Updating the app later

If you ever want to change something (or I send you updates):
1. Edit the file on GitHub directly (or upload a replacement)
2. Render auto-detects the change and redeploys within a minute or two
3. The URL stays the same

---

## Troubleshooting

**The build failed.**
On the Render dashboard, click your service → **Logs** tab. Scroll to the red error. The most common causes:

- *"Cannot find module"* — a file didn't upload to GitHub. Re-upload the `streaming-app` folder, making sure the `lib/` and `public/` subfolders came along.
- *"TMDB 401"* — your TMDB key isn't set or is wrong. Click **Environment** tab → fix the value → **Save Changes**. Render will redeploy automatically.

**The app loads but movies don't.**
Same fix as above — TMDB key issue. Open browser DevTools (F12) → **Network** tab → reload → look for the failing `/api/movies/...` request and check the response.

**The first visit each day is slow.**
That's the cold start — the free tier sleeps after 15 min idle. Wait 30s and the page will load. Subsequent visits are instant for the next 15 minutes.

**I hit OMDB's daily quota.**
OMDB free tier is 1,000 requests/day. Each unique movie/TV detail page costs one request (results are cached for 10 min so revisiting the same page is free). If you exceed this, the app silently falls back to TMDB ratings. To raise the limit, OMDB has paid tiers, or simply wait until tomorrow.

**Something else.**
Send me the error message + a screenshot of what you see and I'll sort it out.

---

## Cost / quota summary

| Service | Free tier | What happens if exceeded |
|---------|-----------|--------------------------|
| Render  | 750 hours/month (one app running 24/7) | App stops responding until next month. Wouldn't happen with one personal app. |
| TMDB    | Effectively unlimited (50 req/sec rate limit) | Brief "rate limited" errors, auto-recover. |
| OMDB    | 1,000 requests/day | App quietly uses TMDB ratings instead. |
| GitHub  | Unlimited public repos | n/a |

You can comfortably run this entirely free for personal use forever.

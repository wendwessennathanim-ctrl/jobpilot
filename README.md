# JobPilot

Your personal job-hunting bot. It scans free public job sources overnight, scores every posting against **your** profile and level, warns you about traps (senior titles, hard experience demands, bachelor's-degree wording with no "or equivalent"), drafts a **cover letter, a tailored resume, and answers to screening questions** for each match, and tracks all your applications on one dashboard.

Zero dependencies. Plain Node.js 22+ — no `npm install` of third-party packages, which also means no supply-chain risk.

---

## The honest limits (read this first)

1. **GitHub Pages cannot run the bot by itself.** Pages only serves static files. So JobPilot has two halves:
   - **GitHub Actions (free)** runs the scanner every night on GitHub's machines and commits a fresh report to `docs/` — Pages serves that as your morning report page. This works even with your computer off.
   - **The full app** (login, tracker, document generation) is a small Node server. It needs one always-on home: your own computer, or a free/cheap host (Render, Railway, Fly.io, a $5 VPS). If it runs on your PC, the overnight scheduler only fires while the PC is on — the GitHub Actions report is the part that truly never sleeps.
2. **It does not scrape LinkedIn or Indeed directly, on purpose.** Those sites ban automated scraping in their Terms, block bots, and gate applications behind logins and CAPTCHAs. Instead JobPilot uses free official APIs and feeds (below) — legal, stable, and they don't get your accounts flagged. You can add any RSS feed yourself, including a Canada Job Bank search feed.
3. **It prepares applications; it does not submit them.** Auto-submitting is exactly what job boards ban and block, and your applications should go out under your own review anyway. JobPilot gets you to one click + paste: open the match, generate, copy, submit on the employer's site, mark it in the tracker.
4. **"AI" works for free two ways.** By default, matching and writing use a built-in rules/template engine — free forever, no key, no account. If you want AI-polished prose, add ONE free-tier key (`GROQ_API_KEY` from groq.com, or `GEMINI_API_KEY` from Google AI Studio) as an environment variable / GitHub secret, and cover letters and answers are rewritten by the model. If the call fails, it falls back to the templates.

---

## Quick start (local)

```bash
# Node 22 or newer required — check with: node --version
node server.js
# open http://localhost:8080
```

1. Create your account (first account is seeded with Nathi's profile: CET-CS at Algonquin, 3.7 GPA, Dean's Honours, plus the Meta Ads / Nathi Media track — edit it in **Settings**).
2. Paste your full general resume in **Settings → General resume**.
3. Press **↻ Run scan now** and wait ~10 seconds. Or just leave it: the scheduler runs it at your chosen hour (default 2 a.m. server time) every day.
4. Open a match → **Generate** → copy the drafts into the employer's application.
5. Track progress on the **Applications** board.

## Put it on GitHub (overnight reports)

```bash
cd jobpilot
git init && git add . && git commit -m "JobPilot"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/jobpilot.git
git branch -M main && git push -u origin main
```

Then in the GitHub repo:

1. **Settings → Actions → General** — allow Actions (default on).
2. **Actions tab → "Nightly job scan" → Run workflow** once to test it. After that it runs daily at 07:00 UTC (2 a.m. EST / 3 a.m. EDT — edit the `cron:` line in `.github/workflows/nightly.yml` to change).
3. **Settings → Pages** — source: *Deploy from a branch*, branch `main`, folder `/docs`. Your report page appears at `https://<you>.github.io/jobpilot/`.
4. Customize matching for the Actions report: copy `profile.example.json` to `profile.json` and edit keywords/skills. **Privacy warning:** if you put your real resume or personal details in `profile.json`, keep the repo **private** (note: Pages on a private repo needs GitHub Pro for personal accounts — otherwise keep `profile.json` light: keywords and skills only, no resume text).

Optional AI keys: **Settings → Secrets and variables → Actions → New repository secret** — `GROQ_API_KEY` or `GEMINI_API_KEY`. Never commit keys to the repo.

## Run the full app on a free host (optional)

Any Node host works; the app is one process + one SQLite file.

- **Render** (free tier): New → Web Service → connect this repo → Build command: *(none needed)* → Start command: `node server.js`. Free instances sleep when idle; the nightly GitHub report still covers you.
- Set env var `COOKIE_SECURE=1` when the host serves HTTPS so session cookies are marked Secure.
- Data resets on some free hosts when they redeploy — export your tracker by keeping the repo report as your source of truth, or use a host with a persistent disk.

## Sources (all free, no keys)

RemoteOK, Arbeitnow, Jobicy, Remotive, Himalayas — plus:

- **Lever companies**: add company slugs in Settings (e.g. `magnetforensics` is pre-seeded — it reads `api.lever.co` directly).
- **Greenhouse boards**: add board tokens in Settings.
- **Any RSS feed**: paste feed URLs in Settings — e.g. build a search on the **Canada Job Bank** (jobbank.gc.ca) and use its RSS/alert feed, or We Work Remotely category feeds, to pull Ottawa co-op postings into the same scoring pipeline.

Each source fails independently; a dead source shows as a warning on the dashboard and never kills the run.

## Security — what's actually implemented

| Threat | Defence |
|---|---|
| SQL injection | Every query is a prepared statement with bound parameters; user input is never concatenated into SQL. A classic `' OR "1"="1` login attempt was tested — it gets a generic error. |
| Password theft | Passwords hashed with **scrypt** + per-user random salt; never stored or logged in plain text; constant-time comparison. |
| Session hijacking | 256-bit random session tokens; only their SHA-256 hashes are stored; cookies are **HttpOnly + SameSite=Lax** (+ Secure on HTTPS); 7-day expiry; logout destroys the session. |
| CSRF | Per-session CSRF token required on every state-changing request (tested: a wrong token is rejected). |
| Brute force | Per-IP rate limits on auth endpoints + account lockout for 15 minutes after 5 failed logins; login errors are generic (no "this email exists" leak). |
| XSS | The UI renders all server/job data via `textContent` (never raw HTML), plus a strict Content-Security-Policy: scripts/styles only from the app itself. |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. |
| Path traversal | Static file serving is normalized and confined to `public/`. |
| Oversized/abusive requests | JSON bodies capped at 512 KB; generic 500s (no stack traces to clients). |

Keep it that way: never commit `.env` or `profile.json` with secrets (both are in `.gitignore`), and if you expose the app publicly, put it behind HTTPS.

## Files

```
server.js                  web server, API, security headers, overnight scheduler
lib/db.js                  SQLite schema (prepared statements everywhere)
lib/auth.js                scrypt passwords, sessions, cookies, CSRF, lockouts
lib/sources.js             free job-source adapters (APIs, Lever/Greenhouse, RSS)
lib/match.js               scoring engine + trap detection + default preferences
lib/generate.js            cover letters, tailored resumes, screening answers (+ optional LLM)
lib/pipeline.js            fetch → store → score → report
scripts/scrape-ci.js       headless run for GitHub Actions → writes docs/ report
public/                    dashboard UI (no frameworks)
.github/workflows/nightly.yml   the overnight GitHub Actions job
profile.example.json       template for the Actions-mode profile
docs/                      generated nightly report (a sample from first run is included)
```

## Tweaking the matcher

All preferences live in **Settings**: title keywords, locations, exclusions, minimum score, remote-only, availability line, scan hour, and source lists. Scoring is explained per job on the dashboard ("Title matches…", "Posted in the last 48h…"), so you can see *why* something ranked and adjust.

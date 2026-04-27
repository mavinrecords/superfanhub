# Mavin SuperFan Hub

A superfan engagement platform for music artists — tasks, squads, leaderboards, rewards, and gift cards, with Spotify/Last.fm streaming integrations and a full admin dashboard.

Pure-black + Mavin gold (`#A2812E`) brand. Mobile-first, WCAG AA compliant, vanilla stack (Node.js + Express + SQLite + vanilla JS).

---

## What's in here

| Surface | Purpose |
|---|---|
| `/` (`index.html`) | Marketing landing page |
| `/login`, `/register` | Fan auth |
| `/dashboard` | Per-fan home: streaming stats, points, badges, streak, connect Spotify/Last.fm |
| `/tasks` | Browse and complete artist tasks (proof submission, points reward) |
| `/squads` | Create / join superfan squads, contribute, see standings |
| `/rewards` | Spend points on rewards from the catalog |
| `/leaderboard` | Top fans by points / streaming minutes |
| `/campaigns` | Active artist campaigns |
| `/gift-cards` | Fan-side gift-card management |
| `/redeem` | Public gift-card / promo-code redemption |
| `/admin` | Full admin dashboard — cards, users, audit log, analytics, moderation |

13 HTML pages, 12 API route modules, 30 service modules, ~60 backend files.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Copy env and fill in secrets
cp .env.example .env       # then edit .env (see "Environment" below)

# 3. Initialize the SQLite database (creates tables + default admin)
npm run init-db

# 4. Start
npm run dev                # auto-reload via node --watch
# or
npm start                  # production mode
```

Default admin: **`admin` / `admin123`** — change this on first login. The `/api/admin` middleware blocks every request until the default password is rotated.

Server listens on `http://localhost:3000` (override with `PORT`).

---

## API surface

All API routes are mounted under `/api`. Browser routes serve the matching HTML page from `public/`.

| Mount | Module | Notes |
|---|---|---|
| `/api/cards` | `src/routes/cards.js` | Public: validate, redeem, balance |
| `/api/admin` | `src/routes/admin.js` | Admin-only: cards, users, audit, analytics |
| `/api/user` | `src/routes/userAuth.js` | Fan auth: register, login, logout, me |
| `/api/loyalty` | `src/routes/loyalty.js` | Points, tiers, streaks |
| `/api/tasks` | `src/routes/tasks.js` | Task list, submit, verify |
| `/api/rewards` | `src/routes/rewards.js` | Catalog, redeem reward |
| `/api/squads` | `src/routes/squads.js` | Squad CRUD, join, contribute |
| `/api/leaderboard` | `src/routes/leaderboard.js` | Rankings |
| `/api/campaigns` | `src/routes/campaigns.js` | Active artist campaigns |
| `/api/spotify` | `src/routes/spotify.js` | OAuth + listen-history sync |
| `/api/lastfm` | `src/routes/lastfm.js` | Username connect + scrobble pull |
| `/api/artists` | `src/routes/artists.js` | Artist roster lookup |
| `/api/health` | inline | Liveness probe |

Every admin write goes through `adminAuditService.js` and lands in the audit log surfaced at `/admin → Audit`.

---

## Project structure

```
.
├── public/                     # Static assets served at /
│   ├── *.html                  # 13 pages
│   ├── css/
│   │   ├── styles.css          # Brand tokens + base components
│   │   ├── home.css            # Marketing landing
│   │   └── mobile.css          # Mobile UX & a11y primitives (drawer, tap-44, focus-visible, ...)
│   ├── js/
│   │   ├── admin.js            # Admin dashboard logic
│   │   ├── redemption.js       # Redeem-page logic
│   │   ├── nav.js              # Off-canvas drawer
│   │   └── toast.js            # Toast stacking + dismissal
│   └── images/
├── src/
│   ├── server.js               # Express entry point
│   ├── db/
│   │   ├── schema.sql          # Full DB schema
│   │   ├── database.js         # better-sqlite3 connection (WAL mode)
│   │   ├── init.js             # First-run init (creates default admin)
│   │   └── migrate.js          # Schema migrations
│   ├── routes/                 # Route handlers (12 modules)
│   ├── services/               # Business logic (30 modules)
│   └── middleware/
│       ├── security.js         # Rate limiting, helmet, request IDs
│       ├── auth.js             # Admin session auth
│       ├── requireUser.js      # Fan JWT auth
│       └── requireAdminRole.js # Admin role gate
├── scripts/
│   └── lookup-spotify-artist-ids.js   # Backfill helper
├── package.json
└── README.md
```

---

## Environment

Required `.env` keys:

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `3000` | Server port |
| `SESSION_SECRET` | **yes (prod)** | dev fallback | Session cookie signing key |
| `NODE_ENV` | no | `development` | `production` enables secure cookies |
| `BASE_URL` | no | `http://localhost:3000` | Used in OAuth callback construction and email links |
| `SPOTIFY_CLIENT_ID` | no | — | Required for Spotify OAuth |
| `SPOTIFY_CLIENT_SECRET` | no | — | Required for Spotify OAuth |
| `SPOTIFY_REDIRECT_URI` | no | — | OAuth callback URL |
| `LASTFM_API_KEY` | no | — | Required for Last.fm scrobble pulls |
| `MAVIN_ARTIST_IDS` | no | — | Comma-separated Spotify artist IDs to pre-populate the roster |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_SECURE` | no | — | Transactional email |
| `RUN_EXPIRY_CHECK_ON_START` | no | `false` | Run reward-expiry sweep immediately at boot (scheduler cron also runs daily) |
| `ADMIN_USERNAME` | no | `admin` | Username used by `npm run init-db` on a fresh DB |
| `ADMIN_PASSWORD` | no | `admin123` (forces rotation) | Password used by `npm run init-db` on a fresh DB. If you set this explicitly, no forced rotation. Min 8 chars |

Fan authentication uses opaque session tokens (no JWT), so there is no `JWT_SECRET`. Sessions are stored server-side and validated via `authService.validateSession`.

Anything left unset disables the corresponding feature gracefully — server still boots.

---

## Database

SQLite via `better-sqlite3` in WAL mode. Single file at the path resolved from the `DB_PATH` env var (defaults to `src/db/giftcards.db`). Schema lives in `src/db/schema.sql`; migrations in `src/db/migrate.js`. All money/points mutations are wrapped in transactions.

### Persistent storage (read this — it's the most common deploy bug)

The container filesystem on every host (Render, Fly, Heroku, Railway, AWS App Runner, …) is **ephemeral**. Without a mounted persistent disk pointed at the directory containing `DB_PATH`, every redeploy creates a fresh empty container, the DB file is gone, and every fan registration / admin session / gift card from before the deploy disappears.

The boot diagnostics at startup tell you whether persistence is working:

```
[db] DB_PATH:           /data/giftcards.db
[db] File exists:       yes              ← good
[db] Last modified:     2026-04-27T...   ← survived from a prior boot
```

If you see `File exists: NO (will be created)` on every boot, your storage is ephemeral and the data will keep vanishing.

| Host | Free-tier disk? | Setup |
|---|---|---|
| **Render Free** | ❌ No persistent disks | Cannot persist — must upgrade or move |
| **Render Starter** ($7/mo) | ✅ Yes | Add Disk → mount at `/data` → set `DB_PATH=/data/giftcards.db` |
| **Fly.io Free** | ✅ 3 GB volume free | `fly volumes create data --size 3` → mount at `/data` → set `DB_PATH=/data/giftcards.db` |
| **Railway Hobby** | ✅ Yes | Volume → mount path `/data` → set `DB_PATH=/data/giftcards.db` |

For multi-instance deployments, migrate to PostgreSQL (the schema is mostly portable, but `better-sqlite3` calls would need to be swapped for `pg` — non-trivial).

---

## Security

- Bcrypt-hashed passwords and gift-card codes
- Helmet headers (CSP, X-Frame-Options, HSTS-ready)
- Rate limiting via `express-rate-limit` (5/min per IP on `/api`, stricter on auth)
- Brute-force lockout on validation endpoints
- Admin session via HTTP-only cookies; fan auth via JWT
- Audit log on every admin write
- WCAG 2.1 AA contrast (see `mobile.css` header for measured ratios)
- `prefers-reduced-motion` honored across all animations
- No third-party tracking

---

## Scripts

```bash
npm start          # Production (node src/server.js)
npm run dev        # Watch mode (node --watch)
npm run init-db    # First-run DB init
npm run migrate    # Apply pending migrations
npm test           # Test runner (node --test src/**/*.test.js)
```

---

## Deployment notes

This is a **stateful, long-lived Node process**. It is not compatible with serverless platforms (Vercel, Cloudflare Workers) without significant rewrites — `node-cron` jobs need a long-lived process, SQLite needs persistent disk, and `express-session` defaults to in-memory.

Recommended: **Render** (Web Service + 1 GB persistent disk on `src/db/`), **Fly.io** (with a volume), or any VPS. Free-tier cold starts will pause `node-cron` schedulers.

### Node version

Pinned to **Node 22 LTS** via `.nvmrc` and `engines.node`. `better-sqlite3@9.6.0` does not have prebuilt binaries for Node 23+ and its source-build fails against the V8 API in those versions. If your platform respects neither file, set `NODE_VERSION=22` as an env var.

### Render-specific setup (Starter plan, $7/mo — needed for disk)

1. New → Web Service → connect repo
2. Build command: `npm install`
3. Start command: `npm start`
4. **Add a Persistent Disk** (this is the part that prevents data loss):
   - Render dashboard → service → **Disks** → **Add Disk**
   - Mount path: `/data`
   - Size: 1 GB (plenty)
5. Set env vars:
   - `NODE_ENV=production`
   - `DB_PATH=/data/giftcards.db` ← **this is critical**, or the DB still lives on the ephemeral container disk
   - `SESSION_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, mark Secret
   - `ADMIN_USERNAME` and `ADMIN_PASSWORD` (min 8 chars, mark Password as Secret) — auto-seeds the admin user on first boot. If unset, falls back to `admin` / `admin123` with forced rotation.
   - Plus any optional integrations: `SPOTIFY_CLIENT_ID`, `LASTFM_API_KEY`, `SMTP_*`, etc.

After the first successful boot, check the deploy logs. You should see:

```
[db] DB_PATH:           /data/giftcards.db
[db] File exists:       NO (will be created)   ← only on the very first boot
```

After the second deploy:

```
[db] File exists:       yes
[db] Last modified:     <some earlier timestamp>
```

That's the confirmation persistence is working. Fan registrations, admin sessions, gift cards, and audit logs all survive future redeploys.

### Fly.io alternative (free 3 GB volume)

```bash
fly launch --name mavin-superfan-hub --no-deploy
fly volumes create data --size 3 --region <your-region>
# Edit fly.toml — add:
#   [mounts]
#     source = "data"
#     destination = "/data"
fly secrets set NODE_ENV=production DB_PATH=/data/giftcards.db SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") ADMIN_PASSWORD=<your-pw>
fly deploy
```

Same boot diagnostics confirm persistence.

### What if I'm already on Render Free with data I want to keep?

You can't. Free-tier storage was wiped on whichever redeploy happened most recently. Upgrade to Starter, mount the disk, set `DB_PATH=/data/giftcards.db`, redeploy — from that moment forward, data persists. Anything registered before that moment is gone.

---

## License

UNLICENSED — internal Mavin Records project.

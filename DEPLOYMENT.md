# Deployment

How to put this demo on a server, and what has to be true before you do.

> **This is a demonstration product.** It moves no money and must not be deployed as
> if it did. Do not add a payment gateway, price credits, or remove the simulation
> labels: real-money gambling needs a licence in the relevant jurisdiction, a
> certified RNG, formal game testing, KYC/AML and a supervised
> responsible-gaming programme. `REAL_MONEY_ENABLED=true` is refused by the
> application itself, on purpose.

## 1. Host

| Requirement | Note |
| --- | --- |
| Node.js ≥ 22.5.0 | `node:sqlite` is the database driver; older Node cannot run this. |
| ~200 MB RAM | Single process, no build step, no bundler, no cache layer. |
| Disk | SQLite file plus WAL: budget 200 MB per 100 000 bets, plus backups. |
| TLS | Mandatory. Cookies are `Secure` in production, so plain HTTP cannot sign anyone in. |
| One instance | The crash round and live studio tables are in-process clocks. Run **one** app instance; do not horizontal-scale without moving those engines behind shared state. |

No `npm install` is needed — the dependency lists in `package.json` are empty.

## 2. Configuration

```bash
git clone <this repository> /srv/arenaplay && cd /srv/arenaplay
cp .env.example .env
```

`.env.example` carries all 47 keys with working local defaults. The ones that
matter for a hosted demo:

| Key | Production value | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | Verbose errors off, `COOKIE_SECURE` on by default, stricter CORS/origin checks. |
| `SESSION_SECRET` | 48+ random chars | `openssl rand -hex 32`. Changing it invalidates every session. |
| `IP_HASH_SALT` | 16+ random chars | Rotating it breaks correlation of old abuse records on purpose. |
| `DATA_DIR` | e.g. `/srv/arenaplay/data` | Where `gambling.db` + WAL live. Must be writable by the service user, and backed up. |
| `DATABASE_FILE` | `gambling.db` | The default in production. |
| `PUBLIC_ORIGIN` | `https://demo.example.com` | Used for absolute links and origin checks; put the real host in it. |
| `TRUST_PROXY` | `true` behind nginx/Caddy | Only then does the rate limiter use `X-Forwarded-For`. Leaving it on without a proxy means a client can spoof its address. |
| `COOKIE_SECURE` | default `true` in prod | `false` only for a local HTTP test you intend to throw away. |
| `DEMO_MODE` / `REAL_MONEY_ENABLED` | `true` / `false` | The guard. Do not touch. |
| `SIGNUP_BONUS_CENTS`, `RESET_DAILY_BONUS`, `MAX_DEMO_CREDIT_CENTS` | per policy | How much play money a demo account holds. |
| `DEFAULT_DAILY_LOSS_LIMIT_CENTS`, `DEFAULT_SESSION_LIMIT_MIN`, `REALITY_CHECK_EVERY_MIN` | stricter than the demo default | Defaults applied to new accounts; players can only tighten them. |
| `RATE_*_MAX` / `RATE_*_WINDOW_S` | as your traffic needs | login, register, bet, write and reset each have their own bucket. |
| `AUTH_FAIL_MAX` / `AUTH_LOCKOUT_MINUTES` | `8` / `15` | Failed sign-ins before the account is locked server-side. |
| `CRASH_BETTING_SECONDS`, `CRASH_FLYING_SECONDS`, `CRASH_GAP_SECONDS` | `8 / 24 / 3` | The crash round clock. |
| `SPORTS_PROVIDER`, `_BASE_URL`, `_KEY`, `SPORTS_REFRESH_SECONDS` | see §6 | Leave `none` unless you have a legitimate data contract. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | your own | Used once, to create the first admin. Change the password immediately. |
| `LOG_LEVEL` | `info` (or `warn`) | `debug` writes a line per request. |

`src/config.js` reads the environment once, freezes the result, and exits with an
explanation if a demo boundary is being crossed. A missing `SESSION_SECRET` in
production is a startup error, not a default.

## 3. Database, migrations, backups

```bash
node src/db/cli.js migrate            # apply pending migrations (idempotent)
node src/db/cli.js seed               # demo catalogue + accounts (dev/test only)
node src/db/cli.js reset              # DANGER: drop everything, migrate, re-seed
node src/db/cli.js backup <file>.db   # safe copy: WAL checkpoint first, then copy
```

`schema_meta` records each applied migration with the hash of its file, so an
edited historical migration is detected rather than silently skipped. Migrations
run in a transaction; a failed one leaves the schema where it was.

Backups: `node:sqlite` in WAL mode keeps recent commits in `gambling.db-wal`, so a
naive copy of the main file restores an older database. `cli.js backup` issues
`PRAGMA wal_checkpoint(TRUNCATE)` first and copies the journal if anything is still
in it. Cron it:

```cron
17 3 * * * cd /srv/arenaplay && /usr/bin/node src/db/cli.js backup /var/backups/arenaplay/$(date +\%F-\%H\%M).db
42 3 * * * find /var/backups/arenaplay -name '*.db*' -mtime +14 -delete
```

Restore: stop the service, move the current `gambling.db*` files aside, put the
backup in place as `gambling.db` (delete any stale `-wal`/`-shm`), start, and
check `/api/health`. Test a restore quarterly — an untested backup is a rumour.

## 4. Service user + systemd

```bash
useradd -r -s /usr/sbin/nologin arenaplay
mkdir -p /srv/arenaplay/data /var/backups/arenaplay
chown -R arenaplay:arenaplay /srv/arenaplay /var/backups/arenaplay
chmod 600 /srv/arenaplay/.env
```

`/etc/systemd/system/arenaplay.service`:

```ini
[Unit]
Description=ArenaPlay demo platform
After=network.target

[Service]
User=arenaplay
Group=arenaplay
WorkingDirectory=/srv/arenaplay
EnvironmentFile=/srv/arenaplay/.env
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/arenaplay/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`ProtectSystem=strict` with a single writable data directory is enough for this
app: it writes no other files. The server handles `SIGTERM` by closing the listener,
stopping the round engines and letting in-flight requests finish, so
`TimeoutStopSec=20` gives a clean stop.

```bash
systemctl daemon-reload && systemctl enable --now arenaplay
journalctl -u arenaplay -f
```

## 5. TLS and the reverse proxy

Bind the app to `127.0.0.1` behind a proxy (`HOST=127.0.0.1`, `TRUST_PROXY=true`) —
or to `0.0.0.0` only if it is directly exposed and firewalled to 443.

nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name demo.example.com;
  ssl_certificate     /etc/letsencrypt/live/demo.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/demo.example.com/privkey.pem;
  client_max_body_size 512k;            # the app also caps bodies at 256 KB

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;            # SSE needs more than the 60s request timeout
    proxy_buffering off;                # otherwise event-stream frames stall
  }
}
server { listen 80; server_name demo.example.com; return 301 https://$host$request_uri; }
```

Caddy is one line if you prefer it: `reverse_proxy 127.0.0.1:3000` inside a site
block, and it disables response buffering for `text/event-stream` by itself.

The app sets `Content-Security-Policy` with a per-request nonce,
`X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`,
`X-Frame-Options: DENY` and `Permissions-Policy`. The HTML shell substitutes the
nonce at serve time, so a CDN that caches HTML across requests would serve a stale
nonce: cache the static assets under `/css`, `/js`, `/assets`, and keep `/` and
`/api/*` un-cached.

## 6. Sports data (optional)

With `SPORTS_PROVIDER=none` the sports pages run on the seeded demo fixtures and
every board is marked **demo data**; bets settle against the simulation. That is the
recommended setting for a demo.

To show real scores you need your own contract with a provider, and then
`SPORTS_PROVIDER`, `SPORTS_PROVIDER_BASE_URL`, `SPORTS_PROVIDER_KEY` and
`SPORTS_REFRESH_SECONDS` are honoured: each fixture stores its source and last-sync
time, and no score is invented between syncs. Never point a scraper at a vendor and
call it live data — and never present simulated scores as real.

## 7. Operations

| Task | How |
| --- | --- |
| Health | `GET /api/health` → `{status, uptimeSeconds, db, demoMode, maintenance, version}`. Probe it every 30s; restart on 3 failures. |
| Maintenance mode | Admin → Settings → maintenance, or `POST /api/admin/maintenance`. Everything but admin, health, content and auth answers 503 with the notice players see. |
| Pause betting | `PATCH /api/admin/settings` `bets_enabled=false`; bets are refused with a translated reason, existing hands still settle. |
| Close registration | `registration_open=false` in settings. |
| Errors | Admin → Errors reads `error_logs` (signature, count, last seen); resolve restarts the counter. Server-side, uncaught failures land there too. |
| Audit | Admin → Audit log: actor, action, entity, reason, IP hash. Exports are themselves audited. |
| Reports | Admin → Export (users, bets, transactions, audit) as CSV. |
| Metrics | Structured JSON logs on stdout; `journalctl -u arenaplay --since -1h \| grep '"level":"error"'` is the dashboards-lite version. |
| Upgrade | `git pull` → `node src/db/cli.js backup` → `node src/db/cli.js migrate` → `npm test && npm run check:rtp` → `systemctl restart arenaplay`. |
| Rollback | Stop, restore the pre-upgrade backup file, check out the previous tag, start. Migrations here are additive; a migration that rewrites data ships with a written rollback note in the file header. |

## 8. Go-live checklist

```bash
npm test                # 123 tests in 6 files
npm run check:rtp       # 20/20 games within 6pp of their advertised return
npm run check:locale    # both catalogues complete, every reference resolves
npm run check:web       # no broken imports, assets or links
npm run check:dom       # the SPA renders in a DOM (needs `npm i`; skipped without it)
```

CI runs the same list: `.github/workflows/ci.yml` installs the tree, resets the demo
database and executes each check, so a red pipeline means one of them regressed.

- [ ] `.env` is `chmod 600`, not committed, and `SESSION_SECRET` + `IP_HASH_SALT` are random.
- [ ] `NODE_ENV=production`, `TRUST_PROXY=true` only behind your proxy, HTTPS termination in front.
- [ ] The seeded admin password has been changed and the demo player accounts are disabled or removed.
- [ ] `DATA_DIR` is on persistent storage and the backup cron runs and has been restored once.
- [ ] The demo banner, the "simulated" labels on live tables and the demo notice on bet slips are visible — in both languages, on a phone.
- [ ] Admin routes 403 for a non-admin token, and the audit log shows the attempt.
- [ ] `GET /api/health` is green and a sign-in, a bet, a language switch and a reset link all work end to end.
- [ ] Nothing in the deployment offers a deposit, withdrawal or prize, and no payment keys exist anywhere in the environment.

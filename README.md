# ArenaPlay — casino & sports **demo** platform

A complete, responsive gaming product: casino lobby with playable games, a live
studio, a sports book with a demo betting slip, a full player account, an admin
back office with roles and audit, two languages (বাংলা / English) everywhere, a
SQLite-backed API, migrations, automated tests and deployment docs.

> ## Demo mode only
>
> Everything here is **simulated**. Balances are demo credits with **no monetary
> value**; there are no deposits, no withdrawals, no payment gateway, no prizes and
> no real-money betting of any kind. Game rounds, live dealers and sports scores
> are simulations and are labelled as such in the interface.
>
> The refusal is enforced by configuration, not by convention: starting the server
> with `REAL_MONEY_ENABLED=true` or `DEMO_MODE=false` throws and the process exits.
> Turning this into a real-money product needs a licence, qualified legal advice, a
> certified RNG, KYC/AML and a reviewed responsible-gaming programme — none of which
> this repository provides or claims.

No dependencies. Node.js 22.5+ is the whole requirement: the HTTP server, router,
SQLite driver (`node:sqlite`), password hashing and the frontend are all written in
this repository, in plain ES modules. `npm install` is not part of running the app —
the only devDependency in the tree is jsdom, which one check below uses to render the
frontend in a DOM. Nothing else needs it, and `npm start` works in a clean checkout
without `node_modules`.

## Run it

```bash
node --version              # v22.5.0 or newer
cp .env.example .env          # every default works for local use
npm run reset                 # migrate + seed a realistic demo data set
npm run dev                   # http://localhost:3000  (bound to 0.0.0.0)
```

`npm run reset` creates `data/gambling-dev.db` (gitignored) with 20 games, 4 live
studio tables, 6 leagues, 32 teams, 21 fixtures, 6 accounts and ~200 historical
bets, so every screen has something real to show on the first load.

## Check it

```bash
npm test                      # 118 tests in 5 files: registration, login, lockout and
                              # sessions; betting, the wallet ledger, limits and fairness;
                              # 53 engine maths contracts; security and configuration;
                              # the bilingual policy documents
npm run check:rtp             # measures 20 000 rounds per game against the advertised
                              # return; fails above 103% or >6pp off the label
npm run check:locale          # 1 938 keys per language: same key set, same
                              # placeholders, and all 716 t('…') calls resolve
npm run check:web             # resolves every import, asset, manifest icon and
                              # internal link against the router
npm run check:dom             # renders the real SPA in jsdom: 65 page renders across
                              # 28 routes in Bangla and English, signed out and in,
                              # plus one bet placed by clicking the button — it fails
                              # on a blank page, a dead link, an untranslated key or a
                              # leaked value. Skips (does not fail) if jsdom is absent
```

All five are wired into CI-friendly exit codes and are the reason a claim of
"tested" here means something. `check:dom` exists because a build-less frontend can
fail quietly: a mistyped import or a wrong function name still serves HTTP 200 with a
blank `<main>`, and it found exactly that (a dead router, an empty game registry, a
result the next repaint erased) — none of which any server-side test could see.

## Sign in

| Account | Password | Role |
| --- | --- | --- |
| `admin@arenaplay.local` | `ChangeMe_Admin!2026` | admin — full back office |
| `shanto@example.test` | `DemoUser!2026` | moderator — read users, answer tickets |
| `demo_player@example.test` | `DemoUser!2026` | player — 500 000 demo credits |

Change the admin password from **Admin → Settings** before exposing this to a
network; the seeded credentials exist so a fresh clone is testable, not so it can
be left in place.

## What is in it

**Casino** — slots (3 titles with a calibrated paytable, free spins and a paytable
panel), European roulette with a real 37-pocket layout and multi-leg slips,
blackjack with hit/stand/double/split, baccarat with punto-banco drawing and pair
sides, video poker (Jacks or Better), 3-patti against a dealer, dice, mines,
plinko, a money-drop wheel, bingo cards, and a crash round on a server clock.
Every one is playable end to end: bet, animate, settle, credit the wallet, write
the ledger, and leave a verifiable record.

**Live studio** — four scripted tables (roulette, baccarat, speed roulette, dream
wheel) with a round clock, simulated dealers, a countdown you can bet inside and
the same engines underneath as the self-serve games. Labelled as simulated on the
table card and in the round view.

**Sports** — cricket and football dashboards, schedules, teams, fixtures,
scores and a demo bet slip with singles and accumulators, plus pre-match and
in-play screens. Fixture data is either the seeded demo set, visibly marked
**demo data**, or a provider you configure (`SPORTS_PROVIDER`); nothing invents a
live score in between syncs.

**Account** — registration with age and terms confirmation, login with lockout,
logout, password reset through a dev mailbox, profile and avatar, language
preference that follows the account, demo wallet with a full transaction ledger,
bet history with filters, favourites, notifications over SSE, support tickets with
a thread, session list with revoke, data export, account closure, and
responsible-gaming controls (daily loss, weekly wager, session length, reality
checks, cool-down, self-exclusion) enforced server-side.

**Admin** — separate login and role checks on the server for every route:
dashboard, per-game and per-user statistics, user search with status/role/limits
and credit adjustments, catalogue editing (limits, category, return target, edge,
availability), live table control, banners, announcements, bet and transaction
review, settings with sources and defaults, maintenance mode, error monitor, audit
log, CSV exports, support queue. Hiding a button is never the protection: an
unauthorised call answers 403 and the attempt is logged.

**Both languages** — every page, menu, button, form, validation message, game
label, notification and dashboard string exists in Bangla and English. The
preference is stored on the account, mirrored in a cookie for signed-out
visitors, and applied server-side to API messages. Numbers and dates go through
`Intl` with Bengali digits in Bangla.

## Layout

```
src/
  config.js            one frozen read of the environment; refuses real money
  server.js            HTTP bootstrap, engine start, graceful shutdown
  lib/                 http router, security (scrypt, tokens, rate limits), sse, util
  db/                  driver, migrate.js, migrations/*.sql, seed.js, cli.js
  games/               the engines: rng, reels, cards, table, crash, index
  services/            users, wallet, bets, catalog, fairness, settings, stats,
                       audit, notify, events, live, sports, crash
  api/                 auth, game, sports, account, admin, system  (106 routes)
  data/legal.js        the seven policy documents, bilingual
public/
  index.html           the shell (served with a per-request CSP nonce)
  css/app.css          one stylesheet, no build step
  js/core/             dom, api, i18n, state, sse, ui
  js/pages/            home, lobby, game, live, sports, account, auth, admin, info
  js/game/             session loop, per-engine views, table widgets
  js/locales/en|bn/    the catalogues, seven group files each
tools/                 check-rtp, check-locales, check-web, make-icons
tests/                 5 node:test files, isolated temp database per file
docs/                  API.md, db-schema.md, ARCHITECTURE.md
```

## Reading further

- `docs/ARCHITECTURE.md` — layers, the engine contract, the fairness chain, how to
  add a game, and why the client keeps no copy of any odds.
- `docs/API.md` — all 106 routes with their guards, generated from the router.
- `docs/db-schema.md` — 28 tables, every column, indexes and the money rules.
- `DEPLOYMENT.md` — environment, TLS, backups, maintenance, monitoring, go-live.

## Deliberate limits

- No real money, payments, KYC or prizes; `POST` to a deposit-like route does not
  exist because there is nothing to deposit into.
- Sports "live" scores need your own provider key; without one the boards are
  clearly demo data and the UI says so.
- The RNG is an HMAC over a committed seed so rounds are reproducible and
  verifiable. That is a demonstration choice, not a certified gambling RNG.
- No SMTP: password-reset and notification mail is written to the demo outbox,
  which the sign-in page links in development.

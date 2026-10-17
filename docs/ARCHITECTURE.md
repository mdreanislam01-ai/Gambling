# Architecture

Why the code is shaped this way, and what to keep in mind when you change it.

## Constraints that produced the design

- **Zero dependencies.** The whole platform runs on Node 22.5+ built-ins:
  `node:http`, `node:sqlite`, `node:crypto`, `node:test`. A gaming product is
  reviewed by other people; a lockfile with 900 packages makes that review
  expensive. No framework, no bundler, no CSS preprocessor — the price is that the
  router, template helper and i18n runtime are ours to test.
- **The label has to match the maths.** A demo where "12:1" pays 11:1 is not a
  smaller version of the real problem, it is the same problem. So every paytable,
  side-bet list, row count and wheel option the interface displays is **served from
  the engine module that decides the payout**. The client keeps no copy.
- **Server-side authority.** Limits, balance checks, role gates, bet validation and
  outcomes are computed in the API. The client never decides anything about money,
  and no control relies on being hidden.

## Request lifecycle

```
node src/server.js
  └─ config.js            read + freeze the environment; exit if real money is on
  └─ db/index.js          open SQLite (WAL, foreign keys on), one connection
  └─ services/crash.js    round clock starts (betting → flying → busted → gap)
  └─ services/live.js     studio tables run their scripted round timers
  └─ http.createServer    → api/index.js#handle
        ├─ buildContext   ip hash, locale, session, csrf token
        ├─ security       rate limiter, body cap (drain then 413), CSRF for writes
        ├─ maintenance    503 except /api/admin|health|content|auth
        ├─ router         method+path match, guards (auth: true | 'staff' | 'admin')
        ├─ handler        services → engines → settle → wallet → events
        └─ sendJson       {ok:true,data} | {ok:false,error:{code,params}}
  └─ serveStatic          public/: %CSP_NONCE% and %LOCALE% substitution, splash
```

Errors travel as `HttpError(status, code, params)`; `sendError` maps them and
bails if the response already started, so a broken stream cannot produce a second
header block. Anything unexpected is logged through `services/notify.js` into
`error_logs` (visible in Admin → Errors) and answered with a code, never a stack.

## Layers

| Layer | Lives in | May call | Must not |
| --- | --- | --- | --- |
| Routes | `src/api/*.js` | services, `HttpError` | SQL directly (a couple of read-only listings excepted), or engine internals |
| Services | `src/services/*.js` | db, engines, other services | return a raw row where a shaped public view exists |
| Engines | `src/games/*.js` | `rng.js` and pure maths | touch the database, the wallet, or the clock |
| Client | `public/js/**` | `core/api.js` (fetch + CSRF + toast) | hold a copy of a paytable |

Engines are pure on purpose: given `{stake, selection, game, rng}` they return a
result. That is what makes `tools/check-rtp.mjs`, the 53 engine assertions in
`tests/engines.test.js`, and fairness verification from a seed all possible.

## The engine contract

`src/games/index.js` exposes `ENGINES[key]` for `slots, roulette, dice, mines,
wheel, plinko, bingo, blackjack, baccarat, three_patti, video_poker, crash`.

- `run({stake, selection, game, rng})` — one round, no further input. Used by every
  instant game and by the verifier.
- `init` / `act` / `timeout` — for multi-step games (blackjack, mines, video poker).
  `ENGINES[key].run === init`, `act(state, action, selection)` returns the next state
  or `{error:'err.…'}`; `timeout` settles an abandoned hand. `isMultiStep(game)`
  tells the caller which shape to expect.
- `validate(selection, stake)` on the engine versus `validateSelection(game,
  selection, stake)` on the registry: the latter adds the game's own limits and the
  bet-slip arithmetic (roulette legs must sum to the stake, baccarat/3-patti sides
  must exist on that table).
- Multipliers are **total return**, not profit: 2 means "1:1", 1.95 means
  "0.95:1". Anything displayed as odds is converted once, in `views.js`
  (`oddsLabel`), from the served map.
- Games that need the edge of the house take it from `edgeRate(game, fallback)`, so
  an admin changing `house_edge_bps` actually changes the maths. `edgeBps` clamps a
  real number into 0–2000 bps and only falls back when the value is missing.

Round-based games (`crash`, the live tables) do not use `run`; they own their clock
in `services/crash.js` / `services/live.js`, settle through `bets.js`, and publish a
round ledger that the fairness page can verify.

## Money

`bets.profit` and `wallet` state are the only two places a payout is written:
`settleBetTx` (all settlement) and `wallet.credit/debit` (ledger rows). A stake is
debited inside the same transaction that inserts the bet, a payout is credited
inside the transaction that marks the bet settled, an abandoned hand is refunded.
`user_wallets.balance` is never updated without a matching `transactions` row — a
test asserts the two agree, so a "phantom credit" bug fails the suite instead of
showing up as a player complaint.

Integer credits everywhere. Percentages are basis points (`rtp_bps`,
`house_edge_bps`), because a float at a table is how a rounding argument starts.

## Provably fair

```
server_seed (secret) ──SHA-256──▶ published hash, shown before any bet
roll = HMAC-SHA256("server_seed|nonce|client_seed") ──▶ engine scale
rotate: reveal the old seed, open a new one
verify: recompute, compare payout + status + multiplier + outcome + the hash
```

`nextNonce(userId, clientSeed)` applies a client seed **while the nonce is taken**, so
the roll and the bet's record use the same value; doing it afterwards made every
bet that changed the client seed unverifiable. Verification returns
`scope: 'full'` with a strict match, or `scope: 'not_replayable'` for hands that
contain the player's own decisions (the deal comes from the seed; the choices are
on the bet) — reporting a "mismatch" there would be the software accusing itself
of cheating. A payout coincidence is not a pass: `ok` requires the whole result to
reproduce.

## Return-to-player calibration

`src/games/reels.js` derives a slot's prize scale from the game's configured return:
`lineExpectation` enumerates every payline, `rawRtp` computes the exact expectation
for a layout (cached), and `calibrate` picks the scale that lands on the target,
clamped to 0.02–50. Scatter bonuses are an exact binomial tail, so a "1 in N spins"
statement is arithmetic rather than a Monte Carlo rumour.

`tools/check-rtp.mjs` then runs each game 20 000 times and compares the measurement
with the card's claim. Skill-dependent games (blackjack, video poker, mines, crash)
report the policy used — basic strategy, a published hold rule, a blind mines
policy — and are exempt from the delta but not from the hard `>103%` failure.
`npm run check:rtp` is a delivery gate, not a script that prints trivia: 20/20 must
agree within 6 percentage points.

## Events

`services/events.js` is a small SSE hub: private frames (`wallet:update`,
`bet:opened`, `bet:settled`, `notification`) are addressed by user id, broadcast
frames (`crash:tick`, `live:round`, `sports:*`) go to everyone. Subscriptions are
released on the response's `close`, not the request's, so a proxy that finishes the
request while the stream keeps flowing cannot leave dead listeners holding the
process open. `tests/api-game.test.js` asserts the client sees a real frame;
`/tmp`-style manual checks are not the guard.

## Settings and configuration

`.env.example` lists all 47 keys; `config.js` reads them once and freezes the
object, so nothing can mutate configuration at runtime. Anything an operator should
change without a deploy lives in the `settings` table instead (bonuses, defaults,
flags, maintenance) with the effective value, its source and its built-in default
shown in Admin → Settings. Runtime settings are read per request, which is how
maintenance mode and the registration switch take effect instantly.

## Frontend

One page shell, one router (`public/js/app.js`) with declarative routes and
`auth` / `guest` / `staff` flags — and each flag is a **hint for the UI**, while the
route guard in the API is the actual control. Pages export `render(root, ctx)` and
receive an `alive()` token so a navigation that happened mid-fetch discards the
stale answer instead of painting over the new page.

`js/game/session.js` owns one game instance: stake, balance mirror, place → act →
settle, SSE subscription, result banner, and the verify dialog. Per-engine views
draw the board. `js/game/tables.js` keeps static layout facts only (red numbers,
wheel segment colours, bingo lines) — anything numeric about money comes from the
server.

i18n is a flat key map per language, loaded lazily as ES modules and flattened
once. Missing keys would print the raw code, so `npm run check:locale` walks the
client and fails on any `t('…')` or `data-i18n="…"` reference that no catalogue
defines, plus placeholder drift between the two languages.

## Adding a game

1. Write or reuse an engine in `src/games/` and register it in `index.js`.
2. Add the row to `src/db/seed.js` (category, limits, `rtp`, `edge`, tags, accent).
3. If the play screen shows numbers, publish them from `engineDisplayConfig` in
   `src/api/game.js` — never as a client literal.
4. Add the view in `public/js/game/views.js`, the locale keys in **both** catalogues,
   and a route entry if it needs one.
5. Run `npm test`, `npm run check:rtp`, `npm run check:locale`, `npm run check:web`.
   An engine whose measured return disagrees with its label does not ship.

## What is not here, on purpose

No ORM, no DI container, no queue, no microservices: the SQLite transaction *is*
the consistency mechanism, and the bets table is the queue. No real-money code path
exists to be tempted by. No client-side trust: the balance shown is the balance the
server returned a moment ago, and every action re-validates.

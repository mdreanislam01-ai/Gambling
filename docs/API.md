# API reference

Every route in this build, generated from the router registrations so the table
cannot drift from the code. There is no OpenAPI file to keep in step by hand: the
source of truth is `src/api/*.js`, and this document is what `docs/` carries for
review.

## Envelope

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "err.stake_below_min", "params": { "min": 5000 } } }
```

- `error.code` is a translation key: the client renders it through the Bangla or
  English catalogue, so the API never returns prose in one language.
- `error.params` carries the numbers a message needs. In development and test a
  `detail` string is added; it never appears in production.
- Status is meaningful: 400 validation, 401 sign-in, 403 permission or limit,
  404 missing, 409 a round that already closed, 422 semantics the form can act on,
  423 locked account, 429 rate limited, 503 maintenance or an engine that is off.

## Request rules

| Rule | Behaviour |
| --- | --- |
| CSRF | Any write (non-GET) must echo `x-csrf-token` from the session, or the request is refused with 403 `csrf`. Routes marked "no CSRF" are the pre-login ones that cannot hold a token yet. |
| Locale | Query parameter `?locale=en` or `?locale=bn`, else the session preference, else the `arenaplay_locale` cookie, else the configured default. Affects validation messages and legal documents. |
| Body | JSON only, capped at 256 KB; the socket is drained before the 413 so the client does not see a reset. |
| Rate limits | Per-route buckets (login, register, bet, write, reset); a burst answers 429 with `retryAfter`. |
| Maintenance | 503 `err.maintenance` for everything except admin, health, content and auth. |

## `src/api/auth.js` — Accounts, sessions and password reset

13 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/auth/session` | public | Who the cookie belongs to, plus the CSRF token a write request has to echo. |
| `POST /api/auth/register` | public · no CSRF · rate: register | Create an account, credit the signup bonus, open a session. Age and terms must be confirmed. |
| `POST /api/auth/login` | public · no CSRF · rate: login | Accept email or username. Unknown account and wrong password answer identically; repeated failures lock the row. |
| `POST /api/auth/logout` | auth: user | Delete the session row and clear the cookie. |
| `POST /api/auth/forgot` | public · no CSRF · rate: reset | Record a single-use reset token and queue the mail. The answer never reveals whether the address exists. |
| `POST /api/auth/reset` | public · no CSRF · rate: reset | Spend a reset token: new password, every other session revoked. |
| `POST /api/auth/password` | auth: user · rate: write | Change the password with the current one, then sign every device out. |
| `PATCH /api/account/profile` | auth: user · rate: write | Display name, avatar, language and the phone or address fields the UI offers. |
| `POST /api/account/locale` | public · no CSRF · rate: write | Remember the reading language on the account so it follows the user to another device. |
| `GET /api/account/summary` | auth: user | Everything the account home shows: balance, streaks, limits, unread counts, open hands. |
| `GET /api/account/sessions` | auth: user | The devices signed in as this account, with the salted IP hash and last-seen time. |
| `POST /api/account/sessions/revoke` | auth: user | Sign out this browser, one named device, or every other device. |
| `POST /api/account/close` | auth: user | Close the account: sessions dropped, betting refused, the record kept for the audit trail. |

## `src/api/game.js` — Casino catalogue, betting, hands and fairness

22 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/games` | public | The lobby page: search, category, sort and favourites, with the counts behind the filter chips. |
| `GET /api/games/categories` | public | Category names with how many enabled games each holds, for the lobby rail. |
| `GET /api/games/:key` | public | One game, with the config the play screen draws numbers from and any hand still open. |
| `POST /api/games/:key/bet` | auth: user · rate: bet | Place a casino bet: stake, limits and responsible-gaming checks first, then one engine round. |
| `GET /api/bets/active` | auth: user | Bets waiting on the player, so a reload can pick a hand back up. |
| `POST /api/bets/:id/action` | auth: user · rate: bet | Act on an open hand: hit, stand, double, split, pick a tile, cash out, or draw. |
| `POST /api/bets/:id/abandon` | auth: user | Close an open hand and refund the stake, for the case where the player walks away. |
| `GET /api/bets` | auth: user | Bet history with the filters the history page exposes. |
| `GET /api/wallet` | auth: user | Balance, the pending daily bonus and the last ledger rows. |
| `POST /api/wallet/claim-daily` | auth: user · rate: write | Claim today's demo bonus once per day; the refusal says when the next one is. |
| `GET /api/favorites` | auth: user | The saved game keys for this account. |
| `POST /api/favorites/:gameKey` | auth: user · rate: write | Add or remove a game from the favourites list. |
| `GET /api/fairness` | auth: user | The committed seed hash, the client seed, the nonce counter and the revealed history. |
| `POST /api/fairness/client-seed` | auth: user · rate: write | Set the client seed used for every bet from now on. Long values are truncated, not rejected. |
| `POST /api/fairness/rotate` | auth: user · rate: write | Reveal the current seed and open a new one, which makes past bets verifiable. |
| `GET /api/fairness/verify/:betId` | public | Recompute a settled bet from the published seed and compare every field, not only the payout. |
| `GET /api/crash` | public | The live crash round: phase, multiplier, bust point once known, and recent rounds. |
| `POST /api/crash/cashout` | auth: user · rate: bet | Bank an open crash bet at the multiplier it reached; after the bust this is refused. |
| `GET /api/live/tables` | public | The studio tables: status, dealer, countdown and the last results per table. |
| `GET /api/live/:key` | public | One live table with its seats, its open round and the player's own bets on it. |
| `POST /api/live/:key/bet` | auth: user · rate: bet | Bet into an open live round. Once the countdown reaches zero the seat is closed. |
| `GET /api/rounds/:gameKey` | public | Round ledger for a round-based game, each entry verifiable against its own seed. |

## `src/api/sports.js` — Fixtures, markets and demo bet slips

6 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/sports/fixtures` | public | Fixtures with markets and prices, filtered by sport, league, status or date. |
| `GET /api/sports/leagues` | public | Leagues and competitions with fixture counts, for the sidebar. |
| `GET /api/sports/fixtures/:id` | public | One fixture: teams, scoreboard, every market and the demo result source. |
| `POST /api/sports/bet` | auth: user · rate: bet | Place a demo slip: single or multi, priced from the stored selection odds. |
| `GET /api/sports/status` | public | Whether a provider is connected, when data last synced, and the demo-data flag. |
| `POST /api/sports/refresh` | auth: admin | Ask the configured provider for fresh scores. With no provider it says so instead of inventing any. |

## `src/api/account.js` — Wallet, history, limits, notifications, support

13 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/notifications` | auth: user | The notification list, newest first, with unread counts. |
| `POST /api/notifications/read` | auth: user | Mark one notification or all of them read. |
| `DELETE /api/notifications` | auth: user | Dismiss a notification without reading it. |
| `GET /api/rg/status` | auth: user | Responsible-gaming state: every limit in force, self-exclusion and cool-down expiry, session clock. |
| `POST /api/rg/limits` | auth: user · rate: write | Set or clear daily loss, weekly wager, session and reality-check limits. Lowering is instant; raising is checked. |
| `POST /api/rg/self-exclude` | auth: user · rate: write | Lock play for hours or months. Signs every device out and cannot be shortened by staff. |
| `GET /api/tickets` | auth: user | This account's support tickets and their status. |
| `POST /api/tickets` | auth: user · rate: write | Open a support ticket. A bet reference can be attached so staff see the exact round. |
| `GET /api/tickets/:ref` | auth: user | One ticket with its full message thread. |
| `POST /api/tickets/:ref/reply` | auth: user · rate: write | Reply on an open ticket. |
| `POST /api/tickets/:ref/close` | auth: user | Close your own ticket. |
| `GET /api/account/export/:kind` | auth: user | Ownership is implicit — the queries are scoped to ctx.user.id. |
| `GET /api/account/activity` | auth: user | Daily aggregates: wagered, returned, sessions and time played. |

## `src/api/admin.js` — Back office: users, catalogue, content, settings, reports

40 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/admin/overview` | auth: staff | ---- dashboards --------------------------------------------------------- |
| `GET /api/admin/stats/games` | auth: staff | Per-game play counts, wagered and returned credits, and the measured versus labelled return. |
| `GET /api/admin/stats/users` | auth: staff | Sign-up, activity and retention counts over a window. |
| `GET /api/admin/users` | auth: staff | ---- users -------------------------------------------------------------- |
| `GET /api/admin/users/:id` | auth: staff | One account with wallet, limits, devices and recent audit rows. |
| `PATCH /api/admin/users/:id` | auth: admin | The only admin user edit: status, role, locks, self-exclusion or a password reset. No free-form fields. |
| `POST /api/admin/users/:id/credits` | auth: admin | Add or remove demo credits with a written reason, through the ledger. |
| `POST /api/admin/users/:id/notify` | auth: staff | Send an account a notification from the back office. |
| `GET /api/admin/games` | auth: staff | ---- catalogue ---------------------------------------------------------- |
| `PATCH /api/admin/games/:key` | auth: admin | Edit one game: limits, category, return target, edge, flags, config. Writes are audited. |
| `POST /api/admin/games` | auth: admin | Add a game to the catalogue for an engine that already exists. |
| `GET /api/admin/live-tables` | auth: staff | Studio tables with their round timing and dealer line-up. |
| `PATCH /api/admin/live-tables/:id` | auth: admin | Start, stop or re-time a live table, or change its dealer script. |
| `GET /api/admin/banners` | auth: staff | Home and lobby banners, active or scheduled, with their targets. |
| `POST /api/admin/banners` | auth: admin | Create a banner and when it should run. |
| `PATCH /api/admin/banners/:id` | auth: admin | Edit a banner's copy, media, links or schedule. |
| `DELETE /api/admin/banners/:id` | auth: admin | Retire a banner. |
| `GET /api/admin/announcements` | auth: staff | Site-wide notices with their audience and window. |
| `POST /api/admin/announcements` | auth: admin | Publish an announcement. |
| `PATCH /api/admin/announcements/:id` | auth: admin | Edit an announcement. |
| `DELETE /api/admin/announcements/:id` | auth: admin | Withdraw an announcement. |
| `GET /api/admin/bets` | auth: staff | ---- bets / transactions ------------------------------------------------ |
| `GET /api/admin/transactions` | auth: staff | The credit ledger: bonus, staff adjustments, stakes and payouts. |
| `GET /api/admin/settings` | auth: admin | ---- settings ----------------------------------------------------------- |
| `POST /api/admin/settings` | auth: admin |  |
| `POST /api/admin/maintenance` | auth: admin | Turn maintenance mode on or off, with the message players will see. |
| `GET /api/admin/audit` | auth: admin | ---- logs, errors, mailbox --------------------------------------------- |
| `GET /api/admin/errors` | auth: admin | Captured server errors with counts and the last occurrence. |
| `POST /api/admin/errors/:id/resolve` | auth: admin | Mark an error signature resolved so it starts counting again. |
| `GET /api/admin/mailbox` | auth: admin | The demo outbox: every message the app would have sent, since there is no mail transport. |
| `GET /api/admin/sports/fixtures` | auth: staff | ---- sports ------------------------------------------------------------- |
| `PATCH /api/admin/sports/fixtures/:id` | auth: admin | Edit a demo fixture: time, teams, score, status. |
| `POST /api/admin/sports/fixtures/:id/settle` | auth: admin | Settle a demo fixture against the recorded score and pay the slips. |
| `POST /api/admin/sports/fixtures/:id/markets/suspend` | auth: admin | Suspend or resume one market, which is what stops new bets on it. |
| `POST /api/admin/sports/fixtures` | auth: admin |  |
| `PATCH /api/admin/sports/selections/:id` | auth: admin |  |
| `GET /api/admin/tickets` | auth: staff | ---- support ------------------------------------------------------------ |
| `POST /api/admin/tickets/:id/reply` | auth: staff | Reply to a player and move the ticket to waiting-on-player. |
| `PATCH /api/admin/tickets/:id` | auth: staff | Set a ticket's status or priority, or assign it to a staff account. |
| `GET /api/admin/export/:kind` | auth: admin | ---- exports ------------------------------------------------------------ |

## `src/api/system.js` — Health, shell content, SSE stream, legal documents

6 routes.

| Route | Guards | What it does |
| --- | --- | --- |
| `GET /api/health` | public | Liveness for a load balancer: uptime, database reachability, demo and maintenance flags. |
| `GET /api/content` | public | Everything the shell needs for the first paint. |
| `GET /api/events` | public | The SSE stream this tab listens to for wallet, bet, round and score updates. |
| `GET /api/dev/mailbox/:email` | public | - production: admin only. |
| `GET /api/legal` | public | client never ends up mixing English and Bangla paragraphs. |
| `GET /api/legal/:doc` | public | One policy document, already rendered in the request's language. |

## Server-sent events

`GET /api/events` holds the connection open (no CSRF, unauthenticated allowed for
broadcast frames). The first frame is `retry: 3000` then `event: hello`.

| Event | Audience | Sent when |
| --- | --- | --- |
| `wallet:update` | the user | any credit, debit or settlement |
| `bet:opened`, `bet:settled` | the user | a bet is accepted or resolved |
| `notification` | the user | staff message, limit warning, lock, reset |
| `crash:tick`, `crash:round` | everyone | the crash round advances or busts |
| `live:round` | everyone | a live studio table opens, closes or settles |
| `sports:tick`, `sports:fixture` | everyone | demo fixtures advance or settle |

The hub releases a subscription on the response `close` event, not the request's,
so a proxy that finishes the request while streaming cannot leave a dead listener
behind.

## Error code catalogue

Codes are grouped by prefix: `auth.*` / `val.*` / `sec.*` / `err.*` /
`wallet.*` / `rg.*` / `admin.*` / `sports.*` / `crash.*` / `acc.*`. Each one is
present in both catalogues, and `npm run check:locale` fails if a code is added
without its translations.

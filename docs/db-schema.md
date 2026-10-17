# Database schema

28 tables in `src/db/migrations/001_init.sql`, generated here so the column list
stays honest. SQLite in WAL mode with foreign keys on; every amount is an integer
count of credits (never a float), and the two derived columns are computed by
SQLite so a payout can not be recorded inconsistently.

| Table | Purpose |
| --- | --- |
| `users` | — |
| `sessions` | — |
| `user_wallets` | — |
| `transactions` | — |
| `games` | — |
| `favorites` | — |
| `fairness_seeds` | — |
| `bets` | — |
| `game_rounds` | — |
| `live_round_players` | — |
| `live_tables` | — |
| `sports_leagues` | — |
| `sports_teams` | — |
| `sports_fixtures` | — |
| `sports_markets` | — |
| `sports_selections` | — |
| `bet_slips` | — |
| `notifications` | — |
| `announcements` | — |
| `banners` | — |
| `support_tickets` | — |
| `ticket_messages` | — |
| `audit_logs` | — |
| `error_logs` | — |
| `settings` | — |
| `outbox` | — |
| `daily_stats` | — |
| `schema_meta` | — |

## Columns

### `users`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `email` | TEXT NOT NULL UNIQUE COLLATE NOCASE |
| `username` | TEXT NOT NULL UNIQUE COLLATE NOCASE |
| `password_hash` | TEXT NOT NULL |
| `role` | TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')) |
| `status` | TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')) |
| `locale` | TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','bn')) |
| `avatar` | TEXT |
| `phone` | TEXT |
| `country` | TEXT |
| `birthdate` | TEXT |
| `marketing_optin` | INTEGER NOT NULL DEFAULT 0 |
| `email_verified` | INTEGER NOT NULL DEFAULT 0 |
| `reset_token_hash` | TEXT |
| `reset_expires_at` | TEXT |
| `failed_attempts` | INTEGER NOT NULL DEFAULT 0 |
| `locked_until` | TEXT |
| `self_exclusion_until` | TEXT |
| `daily_loss_limit` | INTEGER |
| `weekly_wager_limit` | INTEGER |
| `session_limit_min` | INTEGER |
| `reality_check` | INTEGER NOT NULL DEFAULT 1 |
| `notify_email` | INTEGER NOT NULL DEFAULT 1 |
| `notify_push` | INTEGER NOT NULL DEFAULT 1 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `last_login_at` | TEXT |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `sessions`

| Column | Definition |
| --- | --- |
| `id` | TEXT PRIMARY KEY |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `csrf_token` | TEXT NOT NULL |
| `ip_hash` | TEXT |
| `user_agent` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `last_seen_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `expires_at` | TEXT NOT NULL |

### `user_wallets`

| Column | Definition |
| --- | --- |
| `user_id` | INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE |
| `balance` | INTEGER NOT NULL DEFAULT 0 |
| `lifetime_wagered` | INTEGER NOT NULL DEFAULT 0 |
| `lifetime_won` | INTEGER NOT NULL DEFAULT 0 |
| `bonus_granted` | INTEGER NOT NULL DEFAULT 0 |
| `version` | INTEGER NOT NULL DEFAULT 0 |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `transactions`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `kind` | TEXT NOT NULL CHECK (kind IN ('bet','payout','refund','bonus','admin_credit','admin_debit','daily_reset','adjustment')) |
| `amount` | INTEGER NOT NULL |
| `balance_after` | INTEGER NOT NULL |
| `reference` | TEXT |
| `note_key` | TEXT |
| `note` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `games`

| Column | Definition |
| --- | --- |
| `key` | TEXT PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `name_key` | TEXT NOT NULL |
| `category` | TEXT NOT NULL |
| `provider` | TEXT NOT NULL DEFAULT 'ArenaPlay Studio' |
| `description_key` | TEXT |
| `min_bet` | INTEGER NOT NULL DEFAULT 100 |
| `max_bet` | INTEGER NOT NULL DEFAULT 500000 |
| `rtp_bps` | INTEGER NOT NULL DEFAULT 9600 |
| `house_edge_bps` | INTEGER NOT NULL DEFAULT 200 |
| `volatility` | TEXT NOT NULL DEFAULT 'medium' CHECK (volatility IN ('low','medium','high')) |
| `layout` | TEXT NOT NULL DEFAULT 'card' |
| `engine` | TEXT NOT NULL DEFAULT 'slots' CHECK (engine IN ('slots','roulette','dice','mines','wheel','plinko','bingo','blackjack','baccarat','three_patti','video_poker','crash','live')) |
| `enabled` | INTEGER NOT NULL DEFAULT 1 |
| `visibility` | TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','logged_in','hidden')) |
| `is_new` | INTEGER NOT NULL DEFAULT 0 |
| `featured` | INTEGER NOT NULL DEFAULT 0 |
| `popularity` | INTEGER NOT NULL DEFAULT 0 |
| `plays` | INTEGER NOT NULL DEFAULT 0 |
| `tags` | TEXT |
| `accent` | TEXT |
| `config` | TEXT |
| `sort` | INTEGER NOT NULL DEFAULT 100 |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `favorites`

| Column | Definition |
| --- | --- |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `game_key` | TEXT NOT NULL REFERENCES games(key) ON DELETE CASCADE |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `fairness_seeds`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `server_seed` | TEXT NOT NULL |
| `server_seed_hash` | TEXT NOT NULL UNIQUE |
| `client_seed` | TEXT NOT NULL DEFAULT 'player' |
| `nonce` | INTEGER NOT NULL DEFAULT 0 |
| `revealed` | INTEGER NOT NULL DEFAULT 0 |
| `rotated_at` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `bets`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `public_id` | TEXT NOT NULL UNIQUE |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `kind` | TEXT NOT NULL CHECK (kind IN ('casino','sports','live')) |
| `game_key` | TEXT REFERENCES games(key) ON DELETE SET NULL |
| `fixture_id` | INTEGER |
| `stake` | INTEGER NOT NULL |
| `currency` | TEXT NOT NULL DEFAULT 'DEMO' |
| `selection` | TEXT |
| `outcome` | TEXT |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','cashout','void')) |
| `payout` | INTEGER NOT NULL DEFAULT 0 |
| `multiplier` | REAL |
| `profit` | INTEGER GENERATED ALWAYS AS (payout - stake) VIRTUAL |
| `state` | TEXT |
| `view` | TEXT |
| `server_seed_hash` | TEXT |
| `nonce` | INTEGER |
| `fair` | INTEGER NOT NULL DEFAULT 0 |
| `round_id` | INTEGER |
| `seed_id` | INTEGER |
| `auto_cashout` | REAL |
| `client_seed` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `settled_at` | TEXT |

### `game_rounds`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `game_key` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','running','ended','void')) |
| `result` | TEXT |
| `server_seed` | TEXT |
| `server_seed_hash` | TEXT |
| `client_seed` | TEXT |
| `nonce` | INTEGER |
| `started_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `ended_at` | TEXT |
| `visible_at` | TEXT |
| `meta` | TEXT |

### `live_round_players`

| Column | Definition |
| --- | --- |
| `round_id` | INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `bet_id` | INTEGER NOT NULL DEFAULT 0 |
| `stake` | INTEGER NOT NULL DEFAULT 0 |
| `selection` | TEXT |
| `settled` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `live_tables`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `key` | TEXT NOT NULL UNIQUE |
| `game_key` | TEXT NOT NULL REFERENCES games(key) ON DELETE CASCADE |
| `name` | TEXT NOT NULL |
| `name_key` | TEXT NOT NULL |
| `dealer_name` | TEXT NOT NULL |
| `dealer_seed` | TEXT |
| `studio` | TEXT |
| `status` | TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','closed')) |
| `min_bet` | INTEGER NOT NULL DEFAULT 500 |
| `max_bet` | INTEGER NOT NULL DEFAULT 200000 |
| `seats` | INTEGER NOT NULL DEFAULT 7 |
| `round_seconds` | INTEGER NOT NULL DEFAULT 22 |
| `players` | INTEGER NOT NULL DEFAULT 0 |
| `accent` | TEXT |
| `enabled` | INTEGER NOT NULL DEFAULT 1 |
| `sort` | INTEGER NOT NULL DEFAULT 100 |

### `sports_leagues`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `key` | TEXT NOT NULL UNIQUE |
| `name` | TEXT NOT NULL |
| `name_key` | TEXT NOT NULL |
| `sport` | TEXT NOT NULL |
| `country` | TEXT |
| `flag` | TEXT |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `sort` | INTEGER NOT NULL DEFAULT 100 |

### `sports_teams`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `league_id` | INTEGER REFERENCES sports_leagues(id) ON DELETE SET NULL |
| `name` | TEXT NOT NULL |
| `short` | TEXT NOT NULL |
| `sport` | TEXT NOT NULL DEFAULT 'football' |
| `color` | TEXT |

### `sports_fixtures`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `external_id` | TEXT |
| `league_id` | INTEGER REFERENCES sports_leagues(id) ON DELETE CASCADE |
| `sport` | TEXT NOT NULL CHECK (sport IN ('football','cricket')) |
| `season` | TEXT |
| `round` | TEXT |
| `venue` | TEXT |
| `home_team_id` | INTEGER REFERENCES sports_teams(id) ON DELETE SET NULL |
| `away_team_id` | INTEGER REFERENCES sports_teams(id) ON DELETE SET NULL |
| `kickoff` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','final','postponed','cancelled')) |
| `minute` | INTEGER |
| `home_score` | INTEGER |
| `away_score` | INTEGER |
| `detail` | TEXT |
| `live_sim` | INTEGER NOT NULL DEFAULT 0 |
| `source` | TEXT NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','provider')) |
| `result_state` | TEXT NOT NULL DEFAULT 'pending' CHECK (result_state IN ('pending','settled')) |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `sports_markets`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `fixture_id` | INTEGER NOT NULL REFERENCES sports_fixtures(id) ON DELETE CASCADE |
| `key` | TEXT NOT NULL |
| `label` | TEXT NOT NULL |
| `label_key` | TEXT NOT NULL |
| `kind` | TEXT NOT NULL DEFAULT '3way' |
| `sort` | INTEGER NOT NULL DEFAULT 100 |
| `status` | TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','settled')) |

### `sports_selections`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `market_id` | INTEGER NOT NULL REFERENCES sports_markets(id) ON DELETE CASCADE |
| `label` | TEXT NOT NULL |
| `label_key` | TEXT NOT NULL |
| `value` | TEXT |
| `odds_bps` | INTEGER NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','won','lost','void')) |
| `sort` | INTEGER NOT NULL DEFAULT 100 |

### `bet_slips`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `legs` | TEXT NOT NULL |
| `stake` | INTEGER NOT NULL DEFAULT 1000 |
| `slip_type` | TEXT NOT NULL DEFAULT 'single' CHECK (slip_type IN ('single','multi')) |
| `total_odds` | REAL |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `notifications`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `level` | TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warn','danger')) |
| `icon` | TEXT |
| `title_key` | TEXT NOT NULL |
| `body_key` | TEXT |
| `params` | TEXT |
| `link` | TEXT |
| `read_at` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `announcements`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `title_en` | TEXT NOT NULL, body_en TEXT NOT NULL |
| `title_bn` | TEXT, body_bn TEXT |
| `type` | TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','bonus','maintenance','tournament','warn')) |
| `link` | TEXT |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `starts_at` | TEXT, ends_at TEXT |
| `created_by` | INTEGER REFERENCES users(id) ON DELETE SET NULL |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `banners`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `title_en` | TEXT NOT NULL, subtitle_en TEXT, cta_en TEXT |
| `title_bn` | TEXT, subtitle_bn TEXT, cta_bn TEXT |
| `badge` | TEXT, target TEXT, media TEXT |
| `accent` | TEXT |
| `sort` | INTEGER NOT NULL DEFAULT 100 |
| `active` | INTEGER NOT NULL DEFAULT 1 |
| `starts_at` | TEXT, ends_at TEXT |
| `clicks` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `support_tickets`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `ref` | TEXT NOT NULL UNIQUE |
| `user_id` | INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE |
| `category` | TEXT NOT NULL DEFAULT 'general' |
| `subject` | TEXT NOT NULL |
| `status` | TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','in_progress','closed')) |
| `priority` | TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')) |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `ticket_messages`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `ticket_id` | INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE |
| `author_user_id` | INTEGER REFERENCES users(id) ON DELETE SET NULL |
| `from_admin` | INTEGER NOT NULL DEFAULT 0 |
| `body` | TEXT NOT NULL |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `audit_logs`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `actor_id` | INTEGER REFERENCES users(id) ON DELETE SET NULL |
| `actor_role` | TEXT |
| `action` | TEXT NOT NULL |
| `entity` | TEXT |
| `entity_id` | TEXT |
| `meta` | TEXT |
| `ip_hash` | TEXT |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `error_logs`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `level` | TEXT NOT NULL DEFAULT 'error' |
| `code` | TEXT |
| `message` | TEXT NOT NULL |
| `stack` | TEXT |
| `path` | TEXT |
| `user_id` | INTEGER |
| `meta` | TEXT |
| `occurrences` | INTEGER NOT NULL DEFAULT 1 |
| `resolved` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |
| `last_seen_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `settings`

| Column | Definition |
| --- | --- |
| `key` | TEXT PRIMARY KEY |
| `value` | TEXT |
| `updated_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `outbox`

| Column | Definition |
| --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `to_email` | TEXT NOT NULL |
| `subject` | TEXT NOT NULL |
| `body` | TEXT NOT NULL |
| `link` | TEXT |
| `kind` | TEXT NOT NULL DEFAULT 'generic' |
| `delivered` | INTEGER NOT NULL DEFAULT 0 |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

### `daily_stats`

| Column | Definition |
| --- | --- |
| `day` | TEXT NOT NULL |
| `users_active` | INTEGER NOT NULL DEFAULT 0 |
| `bets` | INTEGER NOT NULL DEFAULT 0 |
| `wagered` | INTEGER NOT NULL DEFAULT 0 |
| `paid` | INTEGER NOT NULL DEFAULT 0 |
| `wins` | INTEGER NOT NULL DEFAULT 0 |

### `schema_meta`

| Column | Definition |
| --- | --- |
| `version` | INTEGER PRIMARY KEY |
| `name` | TEXT NOT NULL |
| `applied_at` | TEXT NOT NULL DEFAULT (datetime('now')) |

## Indexes

| Index | Table | Columns |
| --- | --- | --- |
| `idx_users_status` | `users` | `status, role` |
| `idx_sessions_user` | `sessions` | `user_id` |
| `idx_sessions_exp` | `sessions` | `expires_at` |
| `idx_tx_user_time` | `transactions` | `user_id, created_at DESC` |
| `idx_tx_kind` | `transactions` | `kind, created_at DESC` |
| `idx_games_cat` | `games` | `category, enabled, sort` |
| `idx_seeds_user` | `fairness_seeds` | `user_id, revealed` |
| `idx_bets_user` | `bets` | `user_id, created_at DESC` |
| `idx_bets_status` | `bets` | `status, created_at DESC` |
| `idx_bets_game` | `bets` | `game_key, created_at DESC` |
| `idx_rounds_game` | `game_rounds` | `game_key, id DESC` |
| `idx_fix_time` | `sports_fixtures` | `kickoff DESC` |
| `idx_fix_status` | `sports_fixtures` | `status, kickoff` |
| `idx_notif_user` | `notifications` | `user_id, read_at, id DESC` |
| `idx_audit_time` | `audit_logs` | `id DESC` |
| `idx_err_time` | `error_logs` | `id DESC` |

## Money and identity rules

- `user_wallets.balance` is the only balance the app reads, and it is only ever
  changed inside `src/services/wallet.js` in the same transaction as the
  `transactions` row it belongs to. `npm run check` style audits in
  `tests/api-game.test.js` assert that the ledger sums to the balance.
- `bets.profit` and one other column are `GENERATED`: SQLite computes them, so a
  settlement cannot write a payout that disagrees with its own stake.
- `transactions.kind` is one of `signup_bonus, daily_bonus, admin_credit,
  admin_debit, stake, payout, refund, reset`. `settleBetTx` is the only writer of
  a payout; `abandonHand` writes a refund.
- Passwords: `users.password_hash` holds a scrypt digest with its own salt and
  parameters, six `$`-separated fields. Nothing else in the row can rebuild it.
- `audit_logs` and `error_logs` are append-only for the app; staff can read and
  export them but no route updates or deletes a row.
- `ip_hash` columns store a keyed hash of the request address using
  `IP_HASH_SALT`, so an IP is correlatable for abuse checks but not readable.

## Migrations

`src/db/migrate.js` applies files in `src/db/migrations/` in name order inside a
transaction and records them in `schema_meta`, with the hash of each file, so a
changed historical migration is detected instead of silently skipped.
`node src/db/cli.js migrate | seed | reset` are the only ways the schema moves.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en','bn')),
  avatar TEXT,
  phone TEXT,
  country TEXT,
  birthdate TEXT,
  marketing_optin INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  reset_token_hash TEXT,
  reset_expires_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  self_exclusion_until TEXT,
  daily_loss_limit INTEGER,
  weekly_wager_limit INTEGER,
  session_limit_min INTEGER,
  reality_check INTEGER NOT NULL DEFAULT 1,
  notify_email INTEGER NOT NULL DEFAULT 1,
  notify_push INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status, role);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  lifetime_wagered INTEGER NOT NULL DEFAULT 0,
  lifetime_won INTEGER NOT NULL DEFAULT 0,
  bonus_granted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bet','payout','refund','bonus','admin_credit','admin_debit','daily_reset','adjustment')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference TEXT,
  note_key TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user_time ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_kind ON transactions(kind, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'ArenaPlay Studio',
  description_key TEXT,
  min_bet INTEGER NOT NULL DEFAULT 100,
  max_bet INTEGER NOT NULL DEFAULT 500000,
  rtp_bps INTEGER NOT NULL DEFAULT 9600,
  house_edge_bps INTEGER NOT NULL DEFAULT 200,
  volatility TEXT NOT NULL DEFAULT 'medium' CHECK (volatility IN ('low','medium','high')),
  layout TEXT NOT NULL DEFAULT 'card',
  engine TEXT NOT NULL DEFAULT 'slots' CHECK (engine IN ('slots','roulette','dice','mines','wheel','plinko','bingo','blackjack','baccarat','three_patti','video_poker','crash','live')),
  enabled INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','logged_in','hidden')),
  is_new INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  popularity INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  accent TEXT,
  config TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_games_cat ON games(category, enabled, sort);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_key TEXT NOT NULL REFERENCES games(key) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, game_key)
);

CREATE TABLE IF NOT EXISTS fairness_seeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_seed TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL UNIQUE,
  client_seed TEXT NOT NULL DEFAULT 'player',
  nonce INTEGER NOT NULL DEFAULT 0,
  revealed INTEGER NOT NULL DEFAULT 0,
  rotated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_seeds_user ON fairness_seeds(user_id, revealed);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('casino','sports','live')),
  game_key TEXT REFERENCES games(key) ON DELETE SET NULL,
  fixture_id INTEGER,
  stake INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DEMO',
  selection TEXT,
  outcome TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost','cashout','void')),
  payout INTEGER NOT NULL DEFAULT 0,
  multiplier REAL,
  profit INTEGER GENERATED ALWAYS AS (payout - stake) VIRTUAL,
  state TEXT,
  view TEXT,
  server_seed_hash TEXT,
  nonce INTEGER,
  fair INTEGER NOT NULL DEFAULT 0,
  round_id INTEGER,
  seed_id INTEGER,
  auto_cashout REAL,
  client_seed TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_game ON bets(game_key, created_at DESC);

CREATE TABLE IF NOT EXISTS game_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'betting' CHECK (status IN ('betting','running','ended','void')),
  result TEXT,
  server_seed TEXT,
  server_seed_hash TEXT,
  client_seed TEXT,
  nonce INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  visible_at TEXT,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON game_rounds(game_key, id DESC);

CREATE TABLE IF NOT EXISTS live_round_players (
  round_id INTEGER NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bet_id INTEGER NOT NULL DEFAULT 0,
  stake INTEGER NOT NULL DEFAULT 0,
  selection TEXT,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, user_id, bet_id)
);

CREATE TABLE IF NOT EXISTS live_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  game_key TEXT NOT NULL REFERENCES games(key) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  dealer_name TEXT NOT NULL,
  dealer_seed TEXT,
  studio TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paused','closed')),
  min_bet INTEGER NOT NULL DEFAULT 500,
  max_bet INTEGER NOT NULL DEFAULT 200000,
  seats INTEGER NOT NULL DEFAULT 7,
  round_seconds INTEGER NOT NULL DEFAULT 22,
  players INTEGER NOT NULL DEFAULT 0,
  accent TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sports_leagues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  sport TEXT NOT NULL,
  country TEXT,
  flag TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sports_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  league_id INTEGER REFERENCES sports_leagues(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'football',
  color TEXT
);

CREATE TABLE IF NOT EXISTS sports_fixtures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT,
  league_id INTEGER REFERENCES sports_leagues(id) ON DELETE CASCADE,
  sport TEXT NOT NULL CHECK (sport IN ('football','cricket')),
  season TEXT,
  round TEXT,
  venue TEXT,
  home_team_id INTEGER REFERENCES sports_teams(id) ON DELETE SET NULL,
  away_team_id INTEGER REFERENCES sports_teams(id) ON DELETE SET NULL,
  kickoff TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','final','postponed','cancelled')),
  minute INTEGER,
  home_score INTEGER,
  away_score INTEGER,
  detail TEXT,
  live_sim INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'demo' CHECK (source IN ('demo','provider')),
  result_state TEXT NOT NULL DEFAULT 'pending' CHECK (result_state IN ('pending','settled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fix_time ON sports_fixtures(kickoff DESC);
CREATE INDEX IF NOT EXISTS idx_fix_status ON sports_fixtures(status, kickoff);

CREATE TABLE IF NOT EXISTS sports_markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL REFERENCES sports_fixtures(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  label_key TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '3way',
  sort INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','settled')),
  UNIQUE (fixture_id, key)
);

CREATE TABLE IF NOT EXISTS sports_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id INTEGER NOT NULL REFERENCES sports_markets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  label_key TEXT NOT NULL,
  value TEXT,
  odds_bps INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','won','lost','void')),
  sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS bet_slips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legs TEXT NOT NULL,
  stake INTEGER NOT NULL DEFAULT 1000,
  slip_type TEXT NOT NULL DEFAULT 'single' CHECK (slip_type IN ('single','multi')),
  total_odds REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','success','warn','danger')),
  icon TEXT,
  title_key TEXT NOT NULL,
  body_key TEXT,
  params TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at, id DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL, body_en TEXT NOT NULL,
  title_bn TEXT, body_bn TEXT,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','bonus','maintenance','tournament','warn')),
  link TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT, ends_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_en TEXT NOT NULL, subtitle_en TEXT, cta_en TEXT,
  title_bn TEXT, subtitle_bn TEXT, cta_bn TEXT,
  badge TEXT, target TEXT, media TEXT,
  accent TEXT,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT, ends_at TEXT,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','in_progress','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_admin INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  meta TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(id DESC);

CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'error',
  code TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  user_id INTEGER,
  meta TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_err_time ON error_logs(id DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  kind TEXT NOT NULL DEFAULT 'generic',
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT NOT NULL,
  users_active INTEGER NOT NULL DEFAULT 0,
  bets INTEGER NOT NULL DEFAULT 0,
  wagered INTEGER NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day)
);

CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

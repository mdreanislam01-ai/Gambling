import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env parser (no dependency). Existing process.env always wins. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    if (value === '') continue;
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const env = process.env;
const str = (k, d) => (env[k] === undefined || env[k] === '' ? d : env[k]);
const int = (k, d) => {
  const v = env[k];
  if (v === undefined || v === '') return d;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (k, d) => {
  const v = env[k];
  if (v === undefined || v === '') return d;
  return /^(1|true|yes|on)$/i.test(v.trim());
};

const NODE_ENV = str('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';
const dataDir = path.resolve(ROOT, str('DATA_DIR', './data'));

const cfg = {
  env: NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  root: ROOT,
  publicDir: path.join(ROOT, 'public'),
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 3000),
  publicOrigin: str('PUBLIC_ORIGIN', ''),
  dataDir,
  dbFile: path.join(dataDir, str('DATABASE_FILE', isProd ? 'gambling.db' : 'gambling-dev.db')),

  secret: str('SESSION_SECRET', ''),
  ipSalt: str('IP_HASH_SALT', 'arenaplay-insecure-ip-salt'),
  cookie: {
    name: str('COOKIE_NAME', 'arenaplay_session'),
    locale: 'arenaplay_locale',
    secure: bool('COOKIE_SECURE', isProd),
    sameSite: str('COOKIE_SAME_SITE', 'Lax'),
  },
  trustProxy: bool('TRUST_PROXY', false),
  maxBodyBytes: int('MAX_BODY_BYTES', 256 * 1024),
  sessionTtlDays: int('SESSION_TTL_DAYS', 14),
  auth: {
    failMax: Math.max(3, int('AUTH_FAIL_MAX', 8)),
    lockoutMin: Math.max(1, int('AUTH_LOCKOUT_MINUTES', 15)),
  },
  scryptLog2N: Math.min(20, Math.max(12, int('PASSWORD_SCRYP_COST_LOG2', 15))),

  demo: {
    mode: bool('DEMO_MODE', true),
    signupBonusCents: int('SIGNUP_BONUS_CENTS', 500000),
    resetDailyBonus: bool('RESET_DAILY_BONUS', true),
    maxBalanceCents: int('MAX_DEMO_CREDIT_CENTS', 10000000),
    /** 100 "cents" = 1 demo credit, so all money math stays integer-exact. */
    unit: 100,
    currency: 'DEMO',
  },

  rg: {
    dailyLossLimitCents: int('DEFAULT_DAILY_LOSS_LIMIT_CENTS', 200000),
    sessionLimitMin: int('DEFAULT_SESSION_LIMIT_MIN', 60),
    realityCheckEveryMin: int('REALITY_CHECK_EVERY_MIN', 20),
  },

  locale: {
    default: str('DEFAULT_LOCALE', 'en'),
    supported: str('SUPPORTED_LOCALES', 'en,bn')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  limits: {
    login: { max: int('RATE_LOGIN_MAX', 10), windowS: int('RATE_LOGIN_WINDOW_S', 300) },
    register: { max: int('RATE_REGISTER_MAX', 5), windowS: int('RATE_REGISTER_WINDOW_S', 3600) },
    bet: { max: int('RATE_BET_MAX', 120), windowS: int('RATE_BET_WINDOW_S', 60) },
    write: { max: int('RATE_WRITE_MAX', 60), windowS: int('RATE_WRITE_WINDOW_S', 60) },
    reset: { max: int('RATE_RESET_MAX', 5), windowS: int('RATE_RESET_WINDOW_S', 900) },
  },

  sports: {
    provider: str('SPORTS_PROVIDER', 'none'),
    baseUrl: str('SPORTS_PROVIDER_BASE_URL', ''),
    key: str('SPORTS_PROVIDER_KEY', ''),
    refreshS: int('SPORTS_REFRESH_SECONDS', 60),
    get liveEnabled() {
      return this.provider !== 'none' && !!this.baseUrl && !!this.key;
    },
  },

  admin: {
    seedEmail: str('SEED_ADMIN_EMAIL', 'admin@arenaplay.local'),
    seedPassword: str('SEED_ADMIN_PASSWORD', 'ChangeMe_Admin!2026'),
  },

  logLevel: str('LOG_LEVEL', isProd ? 'info' : 'debug'),
  crash: {
    bettingSeconds: int('CRASH_BETTING_SECONDS', 8),
    flyingMaxSeconds: int('CRASH_FLYING_SECONDS', 24),
    gapSeconds: int('CRASH_GAP_SECONDS', 3),
  },
};

// ---- Compliance guard -----------------------------------------------------
// Requirement: DEMO mode only. Real-money wagering is not implemented and the
// process refuses to start if anybody tries to force it on via configuration.
if (bool('REAL_MONEY_ENABLED', false)) {
  throw new Error(
    'REAL_MONEY_ENABLED is not supported. This build is demo-mode only: virtual credits with no ' +
      'monetary value, no deposits, withdrawals, cash prizes or payment gateways. Real-money play ' +
      'requires qualified legal advice, a licence in the relevant jurisdiction and written approvals.'
  );
}
if (!cfg.demo.mode) {
  throw new Error('DEMO_MODE cannot be disabled in this build.');
}
if (isProd && !cfg.secret) {
  throw new Error('SESSION_SECRET must be set in production. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
}
if (!cfg.secret) cfg.secret = 'dev-only-insecure-secret-' + cfg.port;

fs.mkdirSync(dataDir, { recursive: true });

export const config = Object.freeze(cfg);
export default config;

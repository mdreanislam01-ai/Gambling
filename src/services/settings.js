import { all, get, run } from '../db/index.js';
import config from '../config.js';
import { json } from '../lib/util.js';

const cache = new Map();
const CACHE_MS = 2000;

export const DEFAULTS = {
  site_name: 'ArenaPlay',
  maintenance_mode: '0',
  maintenance_message_key: 'admin.maintenance_note',
  registration_open: '1',
  bets_enabled: '1',
  live_enabled: '1',
  sports_enabled: '1',
  default_locale: config.locale.default,
  demo_daily_bonus: String(config.demo.resetDailyBonus ? '1' : '0'),
  signup_bonus_cents: String(config.demo.signupBonusCents),
  max_balance_cents: String(config.demo.maxBalanceCents),
  reality_check_every_min: String(config.rg.realityCheckEveryMin),
  default_daily_loss_limit: String(config.rg.dailyLossLimitCents),
  default_session_limit_min: String(config.rg.sessionLimitMin),
  crash_growth: '0.09',
  house_edge_bps: '100',
  support_whatsapp: '',
  support_email: 'support@arenaplay.local',
  terms_version: '1.0.0',
};

export function setting(key, fallback = undefined) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const row = get('SELECT value FROM settings WHERE key = :k', { k: key });
  const value = row?.value ?? DEFAULTS[key] ?? fallback;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function typedSetting(key) {
  const v = setting(key);
  if (v === null || v === undefined) return v;
  if (v === '0' || v === '1') return v === '1';
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function setSetting(key, value) {
  const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value ?? '');
  run(
    `INSERT INTO settings(key, value, updated_at) VALUES(:k,:v,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    { k: key, v }
  );
  cache.delete(key);
  return v;
}

export function allSettings() {
  const rows = all('SELECT key, value, updated_at FROM settings ORDER BY key');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    stored,
    effective: Object.fromEntries([...new Set([...Object.keys(DEFAULTS), ...rows.map((r) => r.key)])].map((k) => [k, stored[k] ?? DEFAULTS[k] ?? null])),
    defaults: DEFAULTS,
  };
}

export const isMaintenance = () => setting('maintenance_mode') === '1';
export const betsEnabled = () => setting('bets_enabled') !== '0';
export const registrationOpen = () => setting('registration_open') !== '0';
export const liveEnabled = () => setting('live_enabled') !== '0';
export const sportsEnabled = () => setting('sports_enabled') !== '0';

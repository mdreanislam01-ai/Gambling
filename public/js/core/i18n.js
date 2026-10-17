/**
 * i18n + locale-aware formatting. Catalogues are plain ES modules so the same
 * files are reusable from the tests (`node --test`), and switching language
 * never requires a rebuild.
 */
import { api } from './api.js';

const catalogs = { en: {}, bn: {} };
const loaded = new Set();
let current = 'en';
const listeners = new Set();

export const SUPPORTED = ['en', 'bn'];
export const LOCALE_LABELS = { en: 'English', bn: 'বাংলা' };
const saved = () => {
  try { return localStorage.getItem('arenaplay.locale'); } catch { return null; }
};
const persist = (code) => {
  try { localStorage.setItem('arenaplay.locale', code); } catch { /* private mode */ }
  document.cookie = `arenaplay_locale=${code}; path=/; max-age=31536000; samesite=lax`;
};

export function preferredLocale(hint) {
  const stored = hint || saved();
  if (SUPPORTED.includes(stored)) return stored;
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return nav.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}

/** Catalogues are authored as nested objects and flattened once at load time. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = typeof v === 'string' ? v : String(v ?? '');
  }
  return out;
}

export async function loadLocale(code) {
  const next = SUPPORTED.includes(code) ? code : 'en';
  if (!loaded.has(next)) {
    const mod = await import(`../locales/${next}.js`);
    catalogs[next] = flatten(mod.default || {});
    loaded.add(next);
  }
  current = next;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next === 'bn' ? 'bn' : 'en';
    document.documentElement.dataset.locale = next;
    document.body?.classList.toggle('font-bengali', next === 'bn');
  }
  return catalogs[next];
}

export const locale = () => current;
/** Flattened catalogue for a loaded locale (used by the parity tests). */
export const catalogOf = (code) => catalogs[code] || {};
export const isBengali = () => current === 'bn';
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export async function setLocale(code, { notifyServer = true } = {}) {
  const next = SUPPORTED.includes(code) ? code : 'en';
  await loadLocale(next);
  persist(next);
  if (notifyServer) {
    try { await api.post('/account/locale', { locale: next }); } catch { /* guest or offline: cookie already set */ }
  }
  for (const fn of listeners) fn(next);
  return next;
}

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
export const toBengaliDigits = (s) => String(s).replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)]);
export const localizeDigits = (s) => (isBengali() ? toBengaliDigits(s) : String(s));

function interpolate(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (_, k) => {
    const v = params[k];
    if (v === undefined || v === null) return '';
    if (typeof v === 'number') return fmtNum(v, { cents: k.endsWith('Cents') || k === 'amount' || k === 'stake' || k === 'payout' || k === 'limit' || k === 'loss' });
    return String(v);
  });
}

/**
 * t('key', params) → translated string; missing keys fall back to English, then
 * `params.defaultValue`, then the key itself. `defaultValue` lets dynamic keys
 * (statuses, kinds) degrade to the raw server value instead of printing a code.
 */
export function t(key, params) {
  const fallback = typeof params?.defaultValue === 'string' ? params.defaultValue : null;
  if (!key) return fallback ?? '';
  if (typeof key === 'object' && key.key) return t(key.key, key.params ?? key);
  const table = catalogs[current] || {};
  const value = table[key] ?? catalogs.en?.[key];
  if (value === undefined) return fallback ?? key;
  const { defaultValue, ...rest } = params || {};
  void defaultValue;
  return interpolate(localizeDigits(value), { ...rest, __rawDigits: true });
}

/**
 * Translate declarative nodes: [data-i18n], [data-i18n-attr], [data-i18n-ph].
 * Called after every render so a language switch never leaves stale text.
 */
export function translateTree(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n, parseParams(node.dataset.i18nParams));
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const part of node.dataset.i18nAttr.split(',')) {
      const [attr, key] = part.split(':').map((s) => s.trim());
      if (attr && key) node.setAttribute(attr, t(key, parseParams(node.dataset.i18nParams)));
    }
  }
  for (const node of root.querySelectorAll('[data-i18n-ph]')) node.setAttribute('placeholder', t(node.dataset.i18nPh));
  for (const node of root.querySelectorAll('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria));
  return root;
}
const parseParams = (s) => {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
};

// ---------------------------------------------------------------------------
// Number / currency / date formatting per locale (Bengali digits included).
// ---------------------------------------------------------------------------
const loc = () => (isBengali() ? 'bn-BD' : 'en-US');

export function fmtNum(value, { cents = false, min = 0, max = 2 } = {}) {
  const n = Number(cents ? value / 100 : value);
  if (!Number.isFinite(n)) return isBengali() ? toBengaliDigits('0') : '0';
  try {
    return new Intl.NumberFormat(loc(), { minimumFractionDigits: min === 0 && Number.isInteger(n) ? 0 : min, maximumFractionDigits: max }).format(n);
  } catch {
    return localizeDigits(String(n));
  }
}

/** Demo credits are shown like money but always tagged so it is never mistaken for cash. */
export function fmtCredits(cents, { withSymbol = true, decimals = 2 } = {}) {
  const n = (Number(cents) || 0) / 100;
  const num = new Intl.NumberFormat(loc(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  return withSymbol ? `${isBengali() ? '৳' : '৳'}${num}` : num;
}

export function fmtMultiplier(x) {
  const n = Number(x) || 0;
  return `${localizeDigits(n.toFixed(2))}×`;
}

export function fmtOdds(bps) {
  const n = (Number(bps) || 0) / 10000;
  return localizeDigits(n.toFixed(2));
}

export function fmtPercent(bps, digits = 1) {
  const n = (Number(bps) || 0) / 100;
  return `${localizeDigits(n.toFixed(digits))}%`;
}

const parseIso = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function fmtDate(v, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  const d = parseIso(v);
  if (!d) return '';
  try { return new Intl.DateTimeFormat(loc(), opts).format(d); } catch { return d.toISOString().slice(0, 10); }
}

export const fmtDateTime = (v) => fmtDate(v, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtTime = (v) => fmtDate(v, { hour: '2-digit', minute: '2-digit' });
export const fmtDateShort = (v) => fmtDate(v, { weekday: 'short', day: 'numeric', month: 'short' });

export function fmtRelative(v) {
  const d = parseIso(v);
  if (!d) return '';
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const unit = abs < 60 ? 'second' : abs < 3600 ? 'minute' : abs < 86400 ? 'hour' : 'day';
  try {
    return new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' }).format(
      Math.round(diffSec / (unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400)),
      unit
    );
  } catch {
    return fmtDateTime(v);
  }
}

/** Kickoff countdown: "in 2h 14m" / "২ ঘণ্টা ১৪ মিনিট পরে". */
/** Human duration (seconds) localized as e.g. "2h 05m" / "২ ঘণ্টা ৫ মিনিট". */
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const parts = [];
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) parts.push(`${fmtNum(d)} ${t(d === 1 ? 'unit.day' : 'unit.days', { defaultValue: 'd' })}`);
  if (h) parts.push(`${fmtNum(h)} ${t(h === 1 ? 'unit.hour' : 'unit.hours', { defaultValue: 'h' })}`);
  if (m || !parts.length) parts.push(`${fmtNum(m)} ${t(m === 1 ? 'unit.minute' : 'unit.minutes', { defaultValue: 'm' })}`);
  return localizeDigits(parts.join(' '));
}

export function fmtCountdown(targetMs) {
  const ms = Number(targetMs) - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const parts = [];
  const dayPart = Math.floor(abs / 86400000);
  const hourPart = Math.floor((abs % 86400000) / 3600000);
  const minPart = Math.floor((abs % 3600000) / 60000);
  const secPart = Math.floor((abs % 60000) / 1000);
  if (dayPart) parts.push(localizeDigits(dayPart) + t(isBengali() ? 'unit.day.short' : 'unit.day.short'));
  if (hourPart || parts.length) parts.push(localizeDigits(hourPart) + t('unit.hour.short'));
  parts.push(localizeDigits(minPart) + t('unit.min.short'));
  if (!dayPart && !hourPart) parts.push(localizeDigits(secPart) + t('unit.sec.short'));
  const joined = parts.join(' ');
  return past ? t('time.ago', { time: joined }) : t('time.in', { time: joined });
}

export const translateErrors = (err) => {
  if (!err) return '';
  if (err.code === 'val.failed' && Array.isArray(err.params?.errors)) {
    return err.params.errors.map((e) => `${e.field ? `${t(`field.${e.field}`)}: ` : ''}${t(e.code, e)}`).join(' · ');
  }
  return t(err.code || 'err.network', err.params || {});
};

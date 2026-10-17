import path from 'node:path';

export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export const isInt = (v) => Number.isInteger(v);
export const toCents = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
};
export const fromCents = (c) => (Number.isFinite(c) ? c / 100 : 0);

export function centsToText(c, locale = 'en') {
  const n = (Number(c) || 0) / 100;
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n);
}

export const json = (v, fallback = null) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

export const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
export const oneOf = (v, list, d) => (list.includes(v) ? v : d);
export const numRange = (v, min, max, d) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number(v);
  if (!Number.isFinite(n)) return d;
  return clamp(n, min, max);
};
export const intRange = (v, min, max, d) => {
  const n = Math.round(numRange(v, min, max, NaN));
  return Number.isFinite(n) ? n : d;
};
export const emailOk = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()) && v.length <= 190;
export const usernameOk = (v) => typeof v === 'string' && /^[a-z0-9_.]{3,24}$/i.test(v.trim());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const daysFromNow = (days) => new Date(Date.now() + days * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
export const agoText = (iso, locale = 'en') => {
  const t = Date.parse(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  const diff = Math.max(0, Math.round((Date.now() - t) / 1000));
  const unit = { en: (v, u) => `${v} ${u}${v === 1 ? '' : 's'} ago`, bn: (v, u) => `${v} ${u} আগে` };
  const fmt = unit[locale] ?? unit.en;
  const pick = (v, u) => fmt(v, u);
  if (diff < 60) return locale === 'bn' ? 'এইমাত্র' : 'just now';
  if (diff < 3600) return pick(Math.floor(diff / 60), locale === 'bn' ? 'মিনিট' : 'min');
  if (diff < 86400) return pick(Math.floor(diff / 3600), locale === 'bn' ? 'ঘণ্টা' : 'hour');
  return pick(Math.floor(diff / 86400), locale === 'bn' ? 'দিন' : 'day');
};

/** Deep-ish clone that is safe for JSON transport. */
export function transportable(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (Buffer.isBuffer(v)) out[k] = v.toString('hex');
    else out[k] = v;
  }
  return out;
}

export const rel = (...p) => path.join(...p);

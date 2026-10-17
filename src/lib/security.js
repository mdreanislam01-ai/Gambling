import crypto from 'node:crypto';
import config from '../config.js';

const SCRYPT = { N: 2 ** config.scryptLog2N, r: 8, p: 1, keylen: 64, maxmem: 256 * 1024 * 1024 };

/** scrypt password hashing: scrypt$<log2N>$<r>$<p>$<saltHex>$<hashHex> */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem,
  });
  return `scrypt$${Math.log2(SCRYPT.N)}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, log2N, r, p, saltHex, hashHex] = parts;
  let expected;
  try {
    expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: 2 ** Number(log2N), r: Number(r), p: Number(p), maxmem: 512 * 1024 * 1024,
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Ordered, translatable password policy issues (client renders the message keys). */
export function passwordIssues(pw) {
  const s = String(pw ?? '');
  const out = [];
  if (s.length < 10) out.push('sec.pw_short');
  if (s.length > 200) out.push('sec.pw_long');
  if (!/[a-z]/.test(s)) out.push('sec.pw_lower');
  if (!/[A-Z]/.test(s)) out.push('sec.pw_upper');
  if (!/[0-9]/.test(s)) out.push('sec.pw_digit');
  if (/^(password|123456|qwerty|letmein|welcome)/i.test(s)) out.push('sec.pw_common');
  // A space at either end is an input accident, and a "symbol" made only of
  // spaces adds nothing — so require real punctuation once the length is sane.
  if (/^\s|\s$/.test(s)) out.push('sec.pw_space');
  if (s.length >= 10 && !/[^A-Za-z0-9\s]/.test(s)) out.push('sec.pw_symbol');
  return [...new Set(out)];
}

export const token = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export const shortCode = (n = 6) =>
  crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n).toUpperCase();
export const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
export const hmacHex = (key, msg) => crypto.createHmac('sha256', key).update(String(msg)).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''), 'utf8');
  const bb = Buffer.from(String(b ?? ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Privacy-conscious logging: never store raw IPs. */
export function hashIp(ip) {
  return sha256(`${config.ipSalt}|${ip || 'unknown'}`).slice(0, 32);
}

// ---------------------------------------------------------------------------
// Provably-fair primitives. outcome = HMAC(serverSeed, `${gameKey}:${nonce}:${clientSeed}`)
// The user is shown the hash up-front and the seed afterwards, so any result is verifiable.
// ---------------------------------------------------------------------------
export function fairRoll(serverSeed, nonce, clientSeed, gameKey) {
  return hmacHex(`${serverSeed}:${config.secret}`, `${gameKey}:${nonce}:${clientSeed}`);
}

/** Uniform float in [0,1) from the first 8 hex chars (32 bits). */
export function floatFromHash(hash) {
  return Number.parseInt(hash.slice(0, 8), 16) / 0x100000000;
}

export function intFromHash(hash, maxExclusive, offset = 0) {
  if (maxExclusive <= 0) return offset;
  return offset + (Number.parseInt(hash.slice(0, 8), 16) % maxExclusive);
}

// ---------------------------------------------------------------------------
// Rate limiting — in-process token bucket per key. (Swap for Redis when the
// app is horizontally scaled; the interface is intentionally tiny.)
// ---------------------------------------------------------------------------
export class RateLimiter {
  constructor({ max, windowS }) {
    this.max = max;
    this.windowMs = windowS * 1000;
    this.buckets = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(this.windowMs, 60_000));
    this.timer.unref?.();
  }
  hit(key) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true, remaining: this.max - 1, resetMs: this.windowMs };
    }
    if (b.count >= this.max) return { ok: false, remaining: 0, resetMs: b.resetAt - now };
    b.count += 1;
    return { ok: true, remaining: this.max - b.count, resetMs: b.resetAt - now };
  }
  reset(key) { this.buckets.delete(key); }
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

/** Very small secret store for non-password secrets (e.g. admin TOTP seed placeholder). */
export function encryptSecret(plain, secret = config.secret) {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(`${secret}|enc`).digest();
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${data.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function decryptSecret(payload, secret = config.secret) {
  try {
    const [iv, data, tag] = String(payload).split('.');
    const key = crypto.createHash('sha256').update(`${secret}|enc`).digest();
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

import { hmacHex, floatFromHash } from '../lib/security.js';

/**
 * Crash is round-based: the server (not the client) owns the round lifecycle.
 * The crash point for a round is derived once, before betting opens, so the
 * result cannot change while players are in.
 */
export const CRASH_MIN = 1.0;
export const CRASH_MAX = 5000;

export function crashSeedKey(serverSeed, clientSeed, nonce) {
  return hmacHex(`${serverSeed}`, `crash:${nonce}:${clientSeed || 'default'}`);
}

/**
 * Distribution: point = floor(100·E / (E − H)) / 100 with H a uniform 52-bit
 * value, plus a forced 1.00 bust with probability `houseEdge`. That yields a
 * theoretical RTP of exactly (1 − houseEdge) — no extra scaling is applied, so
 * instant busts do not stack up.
 */
export function crashPoint(serverSeed, clientSeed, nonce, houseEdgeBps = 100) {
  const h = hmacHex(crashSeedKey(serverSeed, clientSeed, nonce), 'point');
  const edge = Math.max(0, Math.min(2000, Number(houseEdgeBps) || 0)) / 10000;
  if (floatFromHash(h.slice(0, 8)) < edge) return CRASH_MIN;
  const e = 2 ** 52;
  const H = Number.parseInt(h.slice(8, 21), 16) % e;
  let point = Math.floor((100 * e) / (e - H)) / 100;
  if (!Number.isFinite(point) || point < CRASH_MIN) point = CRASH_MIN;
  return Math.min(point, CRASH_MAX);
}

/** Instant multiplier curve: how high the plane is at t seconds. */
export function multiplierAt(tSeconds, growth = 0.09) {
  return Math.round(Math.pow(Math.E, growth * tSeconds) * 100) / 100;
}
/** Seconds needed to reach a multiplier. */
export function timeForMultiplier(m, growth = 0.09) {
  return Math.log(Math.max(1, m)) / growth;
}

/**
 * Pure settlement helper used by the round engine and by the tests.
 * `cashedAt` is the multiplier the player accepted, validated server-side.
 */
export function settleCrashBet({ stake, crashPoint: cp, cashedAt }) {
  if (!Number.isFinite(cashedAt) || cashedAt <= 0) return { status: 'lost', payout: 0, multiplier: 0 };
  if (cashedAt > cp) return { status: 'lost', payout: 0, multiplier: 0, reason: 'crashed_before_cashout' };
  const payout = Math.floor(stake * cashedAt);
  return { status: 'cashout', payout, multiplier: cashedAt };
}

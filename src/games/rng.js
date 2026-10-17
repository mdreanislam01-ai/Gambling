import { hmacHex, intFromHash, floatFromHash } from '../lib/security.js';

/**
 * Deterministic, verifiable RNG. Every draw consumes a monotonically increasing
 * counter, so the whole round can be re-derived from (seed, nonce, clientSeed).
 */
export class Rng {
  constructor(seedKey) {
    this.seedKey = String(seedKey);
    this.counter = 0;
  }
  hash(offset = 0) {
    return hmacHex(this.seedKey, `draw:${this.counter + offset}`);
  }
  int(maxExclusive, min = 0) {
    const v = intFromHash(this.hash(), maxExclusive, min);
    this.counter += 1;
    return v;
  }
  float() {
    const v = floatFromHash(this.hash());
    this.counter += 1;
    return v;
  }
  pick(list) {
    return list[this.int(list.length)];
  }
  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export const SUIT_GLYPH = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));

/** Card wire format is a short code: "AS", "10H". Glyphs are resolved in the UI. */
export function buildDeck(rng, decks = 1) {
  const codes = [];
  for (let d = 0; d < decks; d += 1) for (const s of ['S', 'H', 'D', 'C']) for (const r of RANKS) codes.push(`${r}${s}`);
  return rng.shuffle(codes);
}

export const rankOf = (c) => c.slice(0, -1);
export const suitOf = (c) => c.slice(-1);
export const rankIdx = (c) => RANK_ORDER[rankOf(c)] ?? -1;
export const isRed = (c) => suitOf(c) === 'H' || suitOf(c) === 'D';

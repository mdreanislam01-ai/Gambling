import { Rng, buildDeck, rankOf, suitOf, rankIdx } from './rng.js';

// ---------------------------------------------------------------------------
// ROULETTE — European single-zero wheel. Inside (straight / split / street /
// corner / six-line) and outside bets, several bets per spin.
// ---------------------------------------------------------------------------
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

/**
 * House edge in basis points for the row being played. `services/bets.js` hands
 * the engines the *shaped* catalogue row (camelCase), while tests and old
 * callers pass the raw DB row (snake_case); both must mean the same thing, and
 * the value the admin edits has to be the value that is actually used.
 */
export function edgeBps(game, fallback = 100) {
  const raw = game?.house_edge_bps ?? game?.houseEdgeBps;
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  // A nonsense value falls back to the engine default; a real number is clamped
  // into 0-2000 bps so a typo cannot turn a game into a player-favourable one.
  return Number.isFinite(n) ? Math.max(0, Math.min(2000, n)) : fallback;
}

export function edgeRate(game, fallback = 100) {
  return edgeBps(game, fallback) / 10000;
}

export function rouletteNumberInfo(n) {
  return {
    number: n,
    colour: n === 0 ? 'green' : RED.has(n) ? 'red' : 'black',
    parity: n === 0 ? 'none' : n % 2 === 0 ? 'even' : 'odd',
    range: n === 0 ? 'none' : n <= 18 ? 'low' : 'high',
    dozen: n === 0 ? 0 : Math.ceil(n / 12),
    column: n === 0 ? 0 : ((n - 1) % 3) + 1,
  };
}

export function rouletteBetPayout(type, numbers, value, n) {
  const info = rouletteNumberInfo(n);
  const list = Array.isArray(numbers) ? numbers.map(Number) : [];
  const win = (mult) => ({ won: true, mult });
  const lose = (mult) => ({ won: false, mult });
  switch (type) {
    case 'straight': return list[0] === n ? win(36) : lose(36);
    case 'split': return list.includes(n) ? win(12) : lose(12);
    case 'street': return list.includes(n) ? win(12) : lose(12);
    case 'corner': return list.includes(n) ? win(9) : lose(9);
    case 'sixline': return list.includes(n) ? win(6) : lose(6);
    case 'red': return info.colour === 'red' ? win(2) : lose(2);
    case 'black': return info.colour === 'black' ? win(2) : lose(2);
    case 'odd': return info.parity === 'odd' ? win(2) : lose(2);
    case 'even': return info.parity === 'even' ? win(2) : lose(2);
    case 'low': return info.range === 'low' ? win(2) : lose(2);
    case 'high': return info.range === 'high' ? win(2) : lose(2);
    case 'dozen': return info.dozen === Number(value) ? win(3) : lose(3);
    case 'column': return info.column === Number(value) ? win(3) : lose(3);
    default: return { won: false, mult: 0, error: 'game.bet_type_unknown' };
  }
}

/** Valid inside-bet number groups, used by the UI and by server validation. */
export function rouletteGroupNumbers(type, start) {
  const s = Number(start);
  if (!Number.isInteger(s) || s < 0 || s > 36) return null;
  switch (type) {
    case 'straight': return [s];
    case 'split': return s % 3 === 0 ? null : [s, s + 1];
    case 'street': { const base = s - (s - 1) % 3; return base < 1 || base + 2 > 36 ? null : [base, base + 1, base + 2]; }
    case 'corner': {
      const col = ((s - 1) % 3) + 1;
      if (col === 3 || s > 33) return null;
      return [s, s + 1, s + 3, s + 4];
    }
    case 'sixline': {
      const base = s - ((s - 1) % 3);
      if (base + 5 > 36) return null;
      return [base, base + 1, base + 2, base + 3, base + 4, base + 5];
    }
    default: return null;
  }
}

export const roulette = {
  key: 'roulette',
  init({ rng, selection }) {
    const bets = (Array.isArray(selection?.bets) ? selection.bets : [])
      .map((b) => {
        const r = rouletteBetPayout(b.type, b.numbers, b.value, -1);
        return { type: b.type, numbers: Array.isArray(b.numbers) ? b.numbers.map(Number) : [], value: b.value ?? null, amount: Math.max(0, Math.round(Number(b.amount) || 0)) };
      })
      .filter((b) => b.amount > 0);
    const idx = rng.int(WHEEL_ORDER.length);
    const n = WHEEL_ORDER[idx];
    const legs = bets.map((b) => {
      const { won, mult, error } = rouletteBetPayout(b.type, b.numbers, b.value, n);
      return { ...b, won, mult, payout: won ? Math.floor(b.amount * mult) : 0, error };
    });
    const staked = legs.reduce((a, b) => a + b.amount, 0);
    const payout = legs.reduce((a, b) => a + b.payout, 0);
    const bad = legs.find((l) => l.error);
    if (bad) return { error: bad.error };
    return {
      status: payout === 0 ? 'lost' : 'won',
      payout,
      multiplier: staked ? payout / staked : 0,
      outcome: { number: n, wheelIndex: idx, info: rouletteNumberInfo(n), legs, sequence: Array.from({ length: 1 }, () => n) },
    };
  },
};

// ---------------------------------------------------------------------------
// DICE — roll under/over a target; payout = (1 - edge) / chance.
// ---------------------------------------------------------------------------
export function dicePayoutMult(mode, target, edge) {
  const chance = mode === 'equal' ? 1 / 100 : mode === 'under' ? target / 100 : (99 - target) / 100;
  return chance > 0 ? (1 - edge) / chance : 0;
}

export const dice = {
  key: 'dice',
  init({ stake, rng, selection, game }) {
    const edge = edgeRate(game, 100);
    const mode = ['under', 'over', 'equal'].includes(selection?.mode) ? selection.mode : 'under';
    const target = Math.min(98, Math.max(2, Math.round(Number(selection?.target) || 50)));
    const roll = rng.int(100);
    const hit = mode === 'under' ? roll < target : mode === 'over' ? roll > target : roll === target;
    const mult = dicePayoutMult(mode, target, edge);
    const payout = hit ? Math.floor(stake * mult) : 0;
    return {
      status: payout > 0 ? 'won' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: { roll, target, mode, chanceBps: Math.round((mode === 'under' ? target : mode === 'over' ? 99 - target : 1) * 100), multiplierBps: Math.round(mult * 10000) },
    };
  },
};

// ---------------------------------------------------------------------------
// MINES — 5×5 grid. Multiplier = exact inverse survival probability / (1 - edge).
// ---------------------------------------------------------------------------
export const MINES_CELLS = 25;
export function minesMultiplier(mines, picks, edge = 0.01) {
  let p = 1;
  for (let s = 0; s < picks; s += 1) p *= (MINES_CELLS - mines - s) / (MINES_CELLS - s);
  return p > 0 ? (1 - edge) / p : 0;
}

export const mines = {
  key: 'mines',
  multiStep: true,
  init({ stake, rng, selection, game }) {
    const count = Math.min(24, Math.max(1, Math.round(Number(selection?.mines) || 3)));
    const edge = selection?.edge !== undefined && Number.isFinite(Number(selection.edge))
      ? Math.max(0, Math.min(0.2, Number(selection.edge)))
      : edgeRate(game, 100);
    const mineSet = new Set();
    while (mineSet.size < count) mineSet.add(rng.int(MINES_CELLS));
    const s = { mines: [...mineSet], picks: [], stake, edge, count, cashedOut: false };
    return { status: 'pending', state: s, view: { revealed: [], multiplier: 1, safeCells: MINES_CELLS - count, minesCount: count }, actions: ['pick', 'cashout'] };
  },
  act({ state, action, selection }) {
    const s = state;
    if (s.cashedOut) return { error: 'err.round_closed' };
    if (action === 'cashout') {
      if (!s.picks.length) return { error: 'err.pick_required' };
      const mult = minesMultiplier(s.count, s.picks.length, s.edge);
      const payout = Math.floor(s.stake * mult);
      s.cashedOut = true;
      return {
        status: 'cashout', payout, multiplier: mult, state: s,
        view: { revealed: s.picks, mines: s.mines, multiplier: mult, cashedOut: true },
        outcome: { grid: s.mines, picks: s.picks, minesCount: s.count, cashedOut: true, multiplierBps: Math.round(mult * 10000) },
      };
    }
    if (action !== 'pick') return { error: 'err.action_unknown' };
    const cell = Math.round(Number(selection?.cell));
    if (!Number.isInteger(cell) || cell < 0 || cell >= MINES_CELLS) return { error: 'err.cell_invalid' };
    if (s.picks.includes(cell)) return { error: 'err.cell_used' };
    s.picks.push(cell);
    if (s.mines.includes(cell)) {
      return {
        status: 'lost', payout: 0, multiplier: 0, state: s,
        view: { revealed: s.picks, mines: s.mines, hit: cell },
        outcome: { grid: s.mines, picks: s.picks, minesCount: s.count, hit: cell, multiplierBps: 0 },
      };
    }
    const mult = minesMultiplier(s.count, s.picks.length, s.edge);
    if (s.picks.length >= MINES_CELLS - s.count) return this.act({ state: s, action: 'cashout', selection: {} });
    return { status: 'pending', state: s, view: { revealed: s.picks, multiplier: mult, picksLeft: MINES_CELLS - s.count - s.picks.length }, actions: ['pick', 'cashout'] };
  },
  timeout: (s) => ({ status: 'lost', payout: 0, multiplier: 0, outcome: { grid: s.mines, picks: s.picks, abandoned: true } }),
};

// ---------------------------------------------------------------------------
// WHEEL — the player calls a multiplier and the wheel either pays it or takes
// the stake. Each visible slice is subdivided finely enough that the winning
// count can express the called multiplier, so the return lands at (1 - edge)
// within a rounding of one sub-slot for every entry in WHEEL_TARGETS.
// ---------------------------------------------------------------------------
export const WHEEL_SEGMENTS = 20;
export const WHEEL_TARGETS = [1.2, 1.5, 2, 3, 5, 10, 20, 50];

/** Sub-slots per visible slice are at least this (and 10x the called multiplier). */
export const WHEEL_SUBSLOTS_MIN = 20;

export const wheel = {
  key: 'wheel',
  init({ stake, rng, selection, game }) {
    const edge = edgeRate(game, 400);
    const target = WHEEL_TARGETS.includes(Number(selection?.target)) ? Number(selection?.target) : 2;
    const segs = WHEEL_SEGMENTS;
    /**
     * Twenty visible slices cannot express the advertised return: one slice is
     * already 5%, so a 50x target needs 0.38 of a slice and rounding the winner
     * count either hands the whole edge back (measured RTP was 100.2% against a
     * 96% label) or pays more than the wheel can fund. Each slice is therefore
     * subdivided into `subSlots` equal slots, which is fine enough for every
     * target in WHEEL_TARGETS, and the leftover winning slots are dealt to
     * random slices so no slice is luckier than its neighbours. The player is
     * paid exactly the multiplier they called, so the maths stays checkable.
     */
    const subSlots = Math.max(WHEEL_SUBSLOTS_MIN, Math.ceil(target) * 10);
    const total = segs * subSlots;
    const winning = Math.max(1, Math.min(total - 1, Math.floor((total * (1 - edge)) / target)));
    const base = Math.floor(winning / segs);
    const extra = winning % segs;
    const boosted = extra > 0
      ? new Set(rng.shuffle(Array.from({ length: segs }, (_, i) => i)).slice(0, extra))
      : new Set();
    const segment = rng.int(segs);
    const slot = rng.int(subSlots);
    const hit = slot < base + (boosted.has(segment) ? 1 : 0);
    const payout = hit ? Math.floor(stake * target) : 0;
    return {
      status: payout > 0 ? 'won' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: {
        segment, segments: segs, subSlots, slot,
        winningSlots: winning,
        winningSegments: Math.round((winning / subSlots) * 100) / 100,
        boosted: [...boosted].sort((a, x) => a - x),
        target, hit,
        payoutMultiplierBps: Math.round(target * 10000),
        rtpBps: Math.round(target * (winning / total) * 10000),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// PLINKO — every row is one fair bit; bucket = number of right turns.
// ---------------------------------------------------------------------------
export const PLINKO_ROWS = 12;
/**
 * Bucket multipliers, mirrored, one entry per exit. These are the *half* tables
 * (centre included); `plinkoTable(risk)` expands them. A row is a fair coin, so
 * bucket k lands with probability C(12,k)/2^12 and the table's expected return is
 * fully determined — the numbers below were tuned so every risk level sits at the
 * 96-97% the game card claims (tools/check-rtp.mjs re-checks it).
 */
export const PLINKO_HALF_TABLES = {
  // 96.7% / 96.0% / 97.4% by exact binomial expectation — see plinkoRtp().
  low: [2.7, 1.7, 1.4, 1.1, 1, 0.9, 0.9],
  medium: [10.2, 3.6, 1.9, 1.3, 1.1, 0.8, 0.7],
  high: [43.7, 11.8, 4.4, 2, 1.1, 0.5, 0.3],
};

export function plinkoTable(risk) {
  const half = PLINKO_HALF_TABLES[risk] ?? PLINKO_HALF_TABLES.medium;
  return [...half, ...half.slice(0, -1).reverse()];
}

export const PLINKO_TABLES = {
  low: plinkoTable('low'),
  medium: plinkoTable('medium'),
  high: plinkoTable('high'),
};

/** Expected return of a table under a fair coin per row — the design check. */
export function plinkoRtp(table, rows = PLINKO_ROWS) {
  let total = 0;
  for (let k = 0; k <= rows; k += 1) total += (plinkoWays(rows, k) / 2 ** rows) * (table[k] ?? 0);
  return Math.round(total * 10000) / 10000;
}

function plinkoWays(n, k) {
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return out;
}

export const plinko = {
  key: 'plinko',
  init({ stake, rng, selection }) {
    const risk = PLINKO_TABLES[selection?.risk] ? selection.risk : 'medium';
    const table = PLINKO_TABLES[risk];
    const path = [];
    for (let i = 0; i < PLINKO_ROWS; i += 1) path.push(rng.int(2));
    const bucket = path.reduce((a, b) => a + b, 0);
    const mult = table[bucket] ?? 1;
    const payout = Math.floor(stake * mult);
    return {
      status: payout > stake ? 'won' : payout === stake ? 'void' : 'lost',
      payout,
      multiplier: mult,
      outcome: { path, bucket, risk, multiplierBps: Math.round(mult * 10000), table },
    };
  },
};

// ---------------------------------------------------------------------------
// BINGO (Lucky Ball) — a 3×3 card against a short call list. Deterministic.
// ---------------------------------------------------------------------------
export const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const BINGO_BALLS = 24;
export const BINGO_CALLS = 7;
/** Lines 1-4 pay per line; 5+ is the "cover all" jackpot. Tuned so the engine
 *  returns the ~96% the lobby advertises — see tools/check-rtp.mjs. */
export const BINGO_PAYTABLE = { 1: 2.6, 2: 5.2, 3: 9.5, 4: 16, 5: 36 };

export const bingo = {
  key: 'bingo',
  init({ stake, rng, game }) {
    const edge = edgeRate(game, 400);
    const bag = Array.from({ length: BINGO_BALLS }, (_, i) => i + 1);
    // The card and the calls come from the same bag but are drawn as separate
    // sets: calling all BINGO_BALLS numbers would complete every card, which is
    // how this engine used to pay 395% and never lose.
    const cardNumbers = rng.shuffle(bag).slice(0, 8);
    // A second, independent pass: the calls have to be able to land on the card.
    const called = rng.shuffle(bag).slice(0, BINGO_CALLS);
    const card = [cardNumbers[0], cardNumbers[1], cardNumbers[2], cardNumbers[3], 0, cardNumbers[4], cardNumbers[5], cardNumbers[6], cardNumbers[7]];
    const hit = new Set(called);
    const matched = (idx) => card[idx] === 0 || hit.has(card[idx]);
    const lines = BINGO_LINES.filter((l) => l.every(matched));
    const baseMult = lines.length ? (BINGO_PAYTABLE[Math.min(lines.length, 5)] ?? 0) : 0;
    const mult = baseMult > 0 ? baseMult / (1 + edge) : 0;
    const payout = Math.floor(stake * mult);
    return {
      status: payout > 0 ? 'won' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: {
        card,
        called,
        ballCount: BINGO_BALLS,
        callCount: BINGO_CALLS,
        lines: lines.map((l) => ({ cells: l, numbers: l.map((i) => card[i]) })),
        lineCount: lines.length,
        pattern: lines.length >= 5 ? 'cover_all' : lines.length >= 1 ? `${lines.length}_line${lines.length > 1 ? 's' : ''}` : 'none',
        multiplierBps: Math.round(mult * 10000),
      },
    };
  },
};

export const tableGames = { roulette, dice, mines, wheel, plinko, bingo };
export { dicePayoutMult as dicePayout };

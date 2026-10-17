import { Rng, buildDeck, rankOf, suitOf, rankIdx } from './rng.js';

// ---------------------------------------------------------------------------
// ROULETTE — European single-zero wheel. Inside (straight / split / street /
// corner / six-line) and outside bets, several bets per spin.
// ---------------------------------------------------------------------------
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

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
    const edge = Math.max(0, Math.min(2000, Number(game?.house_edge_bps ?? 100))) / 10000;
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
    const edge = Math.max(0, Math.min(0.2, Number(selection?.edge ?? (Number(game?.house_edge_bps ?? 100) / 10000))));
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
// WHEEL — target-multiplier wheel. Payout is the inverse probability adjusted
// by the house edge, so theoretical RTP is exactly 1 - edge for every target.
// ---------------------------------------------------------------------------
export const WHEEL_SEGMENTS = 20;
export const WHEEL_TARGETS = [1.2, 1.5, 2, 3, 5, 10, 20, 50];

export const wheel = {
  key: 'wheel',
  init({ stake, rng, selection, game }) {
    const edge = Math.max(0, Math.min(2000, Number(game?.house_edge_bps ?? 400))) / 10000;
    const target = WHEEL_TARGETS.includes(Number(selection?.target)) ? Number(selection?.target) : 2;
    const winning = Math.max(1, Math.min(WHEEL_SEGMENTS, Math.round((WHEEL_SEGMENTS * (1 - edge)) / target)));
    const segment = rng.int(WHEEL_SEGMENTS);
    const hit = segment < winning;
    const payoutMult = WHEEL_SEGMENTS / winning;
    const payout = hit ? Math.floor(stake * payoutMult) : 0;
    return {
      status: payout > 0 ? 'won' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: {
        segment, segments: WHEEL_SEGMENTS, winningSegments: winning, target, hit,
        payoutMultiplierBps: Math.round(payoutMult * 10000),
        rtpBps: Math.round(payoutMult * (winning / WHEEL_SEGMENTS) * 10000),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// PLINKO — every row is one fair bit; bucket = number of right turns.
// ---------------------------------------------------------------------------
export const PLINKO_ROWS = 12;
export const PLINKO_TABLES = {
  low: [8.4, 2.9, 1.9, 1.4, 1.2, 1.1, 0.9, 1.1, 1.2, 1.4, 1.9, 2.9, 8.4],
  medium: [13, 3, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 3, 13],
  high: [24, 5.6, 2.1, 1.1, 1, 0.5, 0.1, 0.5, 1, 1.1, 2.1, 5.6, 24],
};

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
// BINGO (Lucky Ball) — 3×3 card vs a 1-24 draw. Deterministic, instant.
// ---------------------------------------------------------------------------
export const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export const bingo = {
  key: 'bingo',
  init({ stake, rng, game }) {
    const edge = Math.max(0, Math.min(2000, Number(game?.house_edge_bps ?? 400))) / 10000;
    const pool = rng.shuffle(Array.from({ length: 24 }, (_, i) => i + 1));
    const card = [pool[0], pool[1], pool[2], pool[3], 0, pool[4], pool[5], pool[6], pool[7]];
    const draw = rng.shuffle(Array.from({ length: 24 }, (_, i) => i + 1));
    const matchedAt = (idx, drawn) => card[idx] === 0 || drawn.includes(card[idx]);
    let lines = 0;
    let winDraw = 0;
    for (let i = 1; i <= draw.length; i += 1) {
      const drawn = draw.slice(0, i);
      const cnt = BINGO_LINES.filter((l) => l.every((cell) => matchedAt(cell, drawn))).length;
      if (cnt > 0) { lines = cnt; winDraw = i; break; }
    }
    const baseMult = lines >= 3 ? 40 : lines === 2 ? 10 : lines === 1 ? 3.5 : 0;
    const mult = baseMult / (1 + edge);
    const payout = Math.floor(stake * mult);
    return {
      status: payout > 0 ? 'won' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: { card, drawn: draw.slice(0, Math.max(winDraw, 12)), lines: BINGO_LINES.filter((l) => l.every((c) => matchedAt(c, draw.slice(0, winDraw)))), winDraw, pattern: lines >= 3 ? 'full_house' : lines === 2 ? 'two_lines' : lines === 1 ? 'one_line' : 'none', multiplierBps: Math.round(mult * 10000) },
    };
  },
};

export const tableGames = { roulette, dice, mines, wheel, plinko, bingo };

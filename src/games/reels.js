import { Rng } from './rng.js';

/**
 * Generic slot engine. Titles differ only by `games.config` (symbols, weights,
 * paytable, lines, free-spin rules), so one reviewed engine drives every slot.
 */
export const DEFAULT_SLOT_CONFIG = {
  reels: 3,
  rows: 3,
  lines: 5,
  symbols: [
    { key: 'seven', weight: 3, pays: { 3: 45 } },
    { key: 'gold', weight: 6, pays: { 3: 18 } },
    { key: 'bell', weight: 10, pays: { 3: 8 } },
    { key: 'lemon', weight: 14, pays: { 3: 4 } },
    { key: 'cherry', weight: 18, pays: { 2: 1.5, 3: 2.5 } },
    { key: 'wild', weight: 4, pays: { 3: 60 }, wild: true },
    { key: 'scatter', weight: 3, pays: {}, scatter: true },
  ],
  freeSpins: { scatterMin: 2, spins: 5, multiplier: 2 },
};

const LINES_3 = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

export function spinGrid(rng, config) {
  const { reels, rows } = config;
  const bag = [];
  for (const s of config.symbols) for (let i = 0; i < Math.max(1, Math.round(s.weight || 1)); i += 1) bag.push(s.key);
  const grid = [];
  for (let r = 0; r < reels; r += 1) {
    const col = [];
    for (let y = 0; y < rows; y += 1) col.push(rng.pick(bag));
    grid.push(col);
  }
  return grid;
}

export function evaluateGrid(grid, config) {
  const byKey = Object.fromEntries(config.symbols.map((s) => [s.key, s]));
  const lines = config.reels === 3 ? LINES_3.slice(0, Math.min(config.lines, 5)) : defaultFiveReelLines(grid[0].length);
  const wins = [];
  let total = 0;
  lines.forEach((line, idx) => {
    const seq = line.map((rowY, reelX) => grid[reelX][rowY]);
    const first = seq.find((k) => !byKey[k]?.wild) ?? seq[0];
    let count = 0;
    for (const k of seq) {
      if (k === first || byKey[k]?.wild) count += 1;
      else break;
    }
    const sym = byKey[first];
    const pay = sym?.pays?.[count] ?? sym?.pays?.[String(count)];
    if (pay) {
      wins.push({ line: idx, symbol: first, count, multiplier: pay, cells: line.map((y, x) => [x, y]) });
      total += pay;
    }
  });
  const scatters = [];
  grid.forEach((col, x) => col.forEach((k, y) => { if (byKey[k]?.scatter) scatters.push([x, y]); }));
  return { wins, totalLineMultiplier: total, scatters: scatters.length, scatterCells: scatters, lines };
}

function defaultFiveReelLines(rows) {
  const lines = [];
  for (let r = 0; r < rows; r += 1) lines.push(Array.from({ length: 5 }, () => r));
  lines.push([0, 1, 2, 1, 0], [2, 1, 0, 1, 2]);
  return lines.slice(0, 20);
}

export const slots = {
  key: 'slots',
  config(game) {
    const cfg = { ...DEFAULT_SLOT_CONFIG, ...(game?.config || {}) };
    return cfg;
  },
  init({ stake, rng, game }) {
    const config = this.config(game);
    const perLine = Math.max(1, Math.floor(stake / Math.min(config.lines, 5)));
    const spins = [];
    let payout = 0;
    let freeSpinsLeft = 0;
    const grid = spinGrid(rng, config);
    const main = evaluateGrid(grid, { ...config, lines: Math.min(config.lines, 5) });
    const baseWin = Math.floor(perLine * main.totalLineMultiplier);
    spins.push({ grid, wins: main.wins, free: false, win: baseWin });
    payout += baseWin;
    if (config.freeSpins && main.scatters >= config.freeSpins.scatterMin) freeSpinsLeft = config.freeSpins.spins;
    const fsMult = config.freeSpins?.multiplier || 1;
    while (freeSpinsLeft > 0 && spins.length < 26) {
      freeSpinsLeft -= 1;
      const fg = spinGrid(rng, config);
      const fe = evaluateGrid(fg, { ...config, lines: Math.min(config.lines, 5) });
      const fw = Math.floor(perLine * fe.totalLineMultiplier * fsMult);
      payout += fw;
      spins.push({ grid: fg, wins: fe.wins, free: true, win: fw });
    }
    return {
      status: payout > stake ? 'won' : payout === stake ? 'void' : 'lost',
      payout,
      multiplier: stake ? payout / stake : 0,
      outcome: {
        grid,
        spins,
        lines: main.lines.length,
        perLine,
        freeSpinsAwarded: config.freeSpins && main.scatters >= config.freeSpins.scatterMin ? config.freeSpins.spins : 0,
        scatters: main.scatters,
        symbols: config.symbols.map((s) => s.key),
      },
    };
  },
};

export const reelGames = { slots };

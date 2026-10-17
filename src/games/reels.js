import { Rng } from './rng.js';

/**
 * Generic slot engine. Titles differ only by `games.config` (symbols, weights,
 * paytable, lines, free-spin rules), so one reviewed engine drives every slot.
 *
 * The paytable in `config.symbols[].pays` is a set of RELATIVE prizes, not the
 * final word on what a spin returns: `calibrate()` measures the raw expectation
 * of the config and scales every prize so the game pays the RTP its catalogue
 * row advertises. Without that, an admin adding a symbol or a designer editing a
 * paytable silently moved the return of the game anywhere from 40% to 900%,
 * while the game card kept saying 96%.
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

/** Paylines for a 5-reel layout: every row plus the two V shapes. */
function defaultFiveReelLines(rows) {
  const lines = [];
  for (let r = 0; r < rows; r += 1) lines.push(Array.from({ length: 5 }, () => r));
  lines.push([0, 1, 2, 1, 0], [2, 1, 0, 1, 2]);
  return lines;
}

/** The lines a spin actually plays, for either reel count. */
export function paylinesFor(config) {
  const rows = Math.max(1, Number(config.rows) || 3);
  const reels = Math.max(2, Number(config.reels) || 3);
  if (reels === 3) return LINES_3.slice(0, Math.max(1, Math.min(Number(config.lines) || 5, LINES_3.length)));
  return defaultFiveReelLines(rows).slice(0, Math.max(1, Math.min(Number(config.lines) || 9, 20)));
}

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

export function evaluateGrid(grid, config, payScale = 1) {
  const byKey = Object.fromEntries(config.symbols.map((s) => [s.key, s]));
  const lines = paylinesFor(config);
  const wins = [];
  let total = 0;
  lines.forEach((line, idx) => {
    const seq = line.map((rowY, reelX) => grid[reelX]?.[rowY]);
    if (seq.some((k) => k === undefined)) return;
    const first = seq.find((k) => !byKey[k]?.wild) ?? seq[0];
    let count = 0;
    for (const k of seq) {
      if (k === first || byKey[k]?.wild) count += 1;
      else break;
    }
    const sym = byKey[first];
    const raw = sym?.pays?.[count] ?? sym?.pays?.[String(count)];
    const pay = raw === undefined ? 0 : Math.round(raw * payScale * 1000) / 1000;
    if (pay > 0) {
      wins.push({ line: idx, symbol: first, count, multiplier: pay, cells: line.map((y, x) => [x, y]) });
      total += pay;
    }
  });
  const scatters = [];
  grid.forEach((col, x) => col.forEach((k, y) => { if (byKey[k]?.scatter) scatters.push([x, y]); }));
  return { wins, totalLineMultiplier: Math.round(total * 1000) / 1000, scatters: scatters.length, scatterCells: scatters, lines };
}

// ---------------------------------------------------------------------------
// Calibration. Every reel position is an independent draw from the weighted
// bag, so the expectation of one payline is an exact sum over the possible
// symbol sequences — the same run logic evaluateGrid uses, no simulation and no
// magic numbers to keep in sync. The free-spin award is a binomial on the
// scatter weight, and bonus spins pay the same lines at the bonus multiplier.
// ---------------------------------------------------------------------------
const symbolProbs = (symbols) => {
  const weights = symbols.map((s) => Math.max(1, Math.round(s.weight || 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  return symbols.map((s, i) => ({ sym: s, p: weights[i] / total }));
};

function lineExpectation(symbols, reelCount) {
  const byKey = Object.fromEntries(symbols.map((s) => [s.key, s]));
  const pool = symbolProbs(symbols);
  const seq = new Array(reelCount);
  // Enumerate every symbol sequence on a payline, weighted by its probability,
  // and apply the same leading-run rule evaluateGrid uses to score a spin.
  let expectation = 0;
  const walk2 = (i, prob) => {
    if (i === reelCount) {
      const first = seq.find((k) => !byKey[k]?.wild) ?? seq[0];
      let count = 0;
      for (const k of seq) {
        if (k === first || byKey[k]?.wild) count += 1;
        else break;
      }
      const raw = byKey[first]?.pays?.[count] ?? byKey[first]?.pays?.[String(count)];
      if (raw) expectation += prob * raw;
      return;
    }
    for (const { sym, p } of pool) {
      seq[i] = sym.key;
      walk2(i + 1, prob * p);
    }
  };
  walk2(0, 1);
  return expectation;
}

/** P(at least `minScatter` scatters land in `cells` independent positions). */
function scatterChance(symbols, cells, minScatter) {
  if (!symbols.some((s) => s.scatter) || !(minScatter > 0)) return 0;
  const q = symbolProbs(symbols).filter((x) => x.sym.scatter).reduce((a, x) => a + x.p, 0);
  if (!(q > 0)) return 0;
  // Exact binomial tail, built iteratively so no factorials are needed.
  let term = Math.pow(1 - q, cells);
  let below = 0;
  for (let k = 0; k < minScatter && k <= cells; k += 1) {
    if (k > 0) term *= ((cells - k + 1) / k) * (q / (1 - q));
    below += term;
  }
  return Math.max(0, Math.min(1, 1 - below));
}

const RTP_CACHE = new Map();

/** Raw return of a config, before calibration. */
export function rawRtp(config) {
  const fingerprint = JSON.stringify([config.symbols, config.reels, config.rows, config.lines, config.freeSpins]);
  const cached = RTP_CACHE.get(fingerprint);
  if (cached !== undefined) return cached;
  const value = rawRtpUncached(config);
  if (RTP_CACHE.size > 200) RTP_CACHE.clear();
  RTP_CACHE.set(fingerprint, value);
  return value;
}

function rawRtpUncached(config) {
  const symbols = Array.isArray(config.symbols) && config.symbols.length ? config.symbols : DEFAULT_SLOT_CONFIG.symbols;
  const reels = Math.max(2, Number(config.reels) || 3);
  const rows = Math.max(1, Number(config.rows) || 3);
  const perLine = 1 / Math.max(1, Number(config.lines) || 1);
  const linesPlayed = paylinesFor({ ...config, symbols }).length;
  const oneLine = lineExpectation(symbols, reels);
  // evaluateGrid divides the stake across the lines the spin actually plays, so
  // `linesPlayed * perLine` is the leverage the stake gets; the engine bets
  // stake/lines, therefore the line count cancels except when config.lines and
  // the playable line count disagree.
  const stakePerLine = 1 / Math.min(Math.max(1, Number(config.lines) || 5), 5);
  const base = oneLine * linesPlayed * stakePerLine;
  const bonus = config.freeSpins?.spins && config.freeSpins?.multiplier
    ? 1 + scatterChance(symbols, reels * rows, Number(config.freeSpins.scatterMin) || 3) * Number(config.freeSpins.spins) * Number(config.freeSpins.multiplier || 1)
    : 1;
  void perLine;
  return base * bonus;
}

export const MAX_PAY_SCALE = 50;
export const MIN_PAY_SCALE = 0.02;

/** Target return for the row, preferring the advertised RTP over the edge. */
export function targetRtp(game) {
  const rtp = Number(game?.rtp_bps ?? game?.rtpBps);
  if (Number.isFinite(rtp) && rtp > 0) return Math.max(0.5, Math.min(0.99, rtp / 10000));
  const edge = Number(game?.house_edge_bps ?? game?.houseEdgeBps);
  if (Number.isFinite(edge) && edge >= 0) return Math.max(0.5, Math.min(0.99, 1 - edge / 10000));
  return 0.96;
}

export function calibrate(config, game) {
  const raw = rawRtp(config);
  const payScale = Number.isFinite(raw) && raw > 0
    ? Math.max(MIN_PAY_SCALE, Math.min(MAX_PAY_SCALE, targetRtp(game) / raw))
    : 1;
  return { ...config, payScale: Math.round(payScale * 100000) / 100000 };
}

export const slots = {
  key: 'slots',
  config(game) {
    return calibrate({ ...DEFAULT_SLOT_CONFIG, ...(game?.config || {}) }, game);
  },
  init({ stake, rng, game }) {
    const config = this.config(game);
    const lines = paylinesFor(config);
    const perLine = Math.max(1, Math.floor(stake / lines.length));
    const spins = [];
    let payout = 0;
    let freeSpinsLeft = 0;
    const grid = spinGrid(rng, config);
    const main = evaluateGrid(grid, config, config.payScale);
    const baseWin = Math.floor(perLine * main.totalLineMultiplier);
    spins.push({ grid, wins: main.wins, free: false, win: baseWin });
    payout += baseWin;
    const scatterMin = Number(config.freeSpins?.scatterMin) || 0;
    if (config.freeSpins && scatterMin > 0 && main.scatters >= scatterMin) freeSpinsLeft = Number(config.freeSpins.spins) || 0;
    const fsMult = Number(config.freeSpins?.multiplier) || 1;
    while (freeSpinsLeft > 0 && spins.length < 26) {
      freeSpinsLeft -= 1;
      const fg = spinGrid(rng, config);
      const fe = evaluateGrid(fg, config, config.payScale);
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
        payScale: config.payScale,
        freeSpinsAwarded: freeSpinsLeft === 0 && spins.length > 1 ? Number(config.freeSpins?.spins) || 0 : 0,
        scatters: main.scatters,
        symbols: config.symbols.map((s) => s.key),
      },
    };
  },
};

export const reelGames = { slots };

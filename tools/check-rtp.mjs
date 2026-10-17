#!/usr/bin/env node
/**
 * Return audit: measure what each engine actually pays and compare it with the
 * RTP the lobby advertises on the game card. Run after touching game maths.
 *
 *   npm run check:rtp            # every enabled game
 *   npm run check:rtp -- slots   # one engine
 *   npm run check-rtp -- --iterations 20000
 *
 * Sampling error shrinks as 1/sqrt(n), so the tolerance below is loose on
 * purpose: this is a regression tripwire for "the maths broke", not a claim
 * that the sixth decimal is right.
 */
import config from '../src/config.js';
import { all } from '../src/db/index.js';
import { ENGINES, validateSelection } from '../src/games/index.js';
import { Rng } from '../src/games/rng.js';
import { WHEEL_TARGETS, PLINKO_TABLES, MINES_CELLS } from '../src/games/table.js';
import { blackjack, videoPoker, evaluatePoker } from '../src/games/cards.js';
import { crashPoint, settleCrashBet } from '../src/games/crash.js';
import { rankIdx, suitOf } from '../src/games/rng.js';

const argv = process.argv.slice(2);
const iterFlag = argv.indexOf('--iterations');
// 20k rounds keeps the sampling error near 1pp on games that pay out often, and
// a couple of pp on long-tail ones — enough to catch broken maths without
// turning this into a slow test.
const ITERATIONS = iterFlag >= 0 ? Number(argv[iterFlag + 1]) : 20000;
const only = argv.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)));
const TOLERANCE = 0.06;

/** Jacks-or-better holding rules, reduced to the cases that carry the RTP. */
function vpHold(cards) {
  const made = evaluatePoker(cards);
  if (made !== 'none') return [0, 1, 2, 3, 4];
  const vals = cards.map(rankIdx);
  const suits = cards.map(suitOf);
  const count = new Map();
  vals.forEach((v, i) => count.set(v, [...(count.get(v) ?? []), i]));
  const pairs = [...count.entries()].filter(([, idx]) => idx.length === 2);
  const flushSuit = suits.find((s) => suits.filter((x) => x === s).length === 4);
  // Four to a flush beats a low pair, so order matters here.
  if (pairs.length >= 2) return [...pairs[0][1], ...pairs[1][1]].slice(0, 4);
  if (flushSuit) return suits.map((s, x) => (s === flushSuit ? x : -1)).filter((x) => x >= 0);
  if (pairs.length === 1) {
    const [v, idx] = pairs[0];
    // RANK_ORDER: 2→0 … J→9, Q→10, K→11, A→12. Jacks or better is v >= 9.
    return v >= 9 ? idx : [...idx, ...[0, 1, 2, 3, 4].filter((x) => !idx.includes(x)).slice(0, 2)];
  }
  // Four cards inside a five-wide window is an open/gutshot straight draw.
  const uniq = [...new Set(vals)].sort((a, b) => a - b);
  if (uniq.length === 4) {
    const span = uniq.at(-1) - uniq[0];
    if (span <= 4) return [0, 1, 2, 3, 4];
  }
  const high = vals.map((v, x) => (v >= 9 ? x : -1)).filter((x) => x >= 0);
  return high.length ? high : [];
}

const SKILL_GAMES = new Set(['mines', 'blackjack', 'video_poker', 'crash']);
const POLICIES = {
  mines: '3 blind picks, then bank',
  blackjack: 'basic strategy, double where allowed, no surrender',
  video_poker: 'simplified jacks-or-better holds (pairs, 4-flush, 4-straight, high cards)',
  crash: 'auto-cashout at 2.00x',
};

const shape = (row) => ({ ...row, engine: row.engine, config: JSON.parse(row.config || '{}') });

function loop(runner) {
  let paid = 0;
  let wagered = 0;
  let wins = 0;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const { stake, payout } = runner(i);
    paid += payout;
    wagered += stake;
    if (payout > stake) wins += 1;
  }
  return { rtp: paid / wagered, winRate: wins / ITERATIONS };
}


/**
 * `policy` matters: three of these engines pay differently depending on how the
 * hand is played (which cell to open, which cards to hold, when to hit). Their
 * catalogue RTP is the return under the documented policy, so a shortfall here
 * is a statement about the audit's play, not about the maths. Luck-only games
 * get a hard verdict; skill games are reported with the policy they used.
 */
const strategies = {
  slots: (g) => (i) => {
    const out = ENGINES.slots.run({ stake: 1000, selection: {}, game: g, rng: new Rng(`rtp|slots|${i}`) });
    return { stake: 1000, payout: out.payout };
  },
  roulette: (g) => (i) => {
    const stake = 1000;
    const selection = validateSelection(g, { bets: [{ type: 'red', amount: stake }] }, stake);
    const out = ENGINES.roulette.run({ stake, selection, game: g, rng: new Rng(`rtp|rou|${i}`) });
    return { stake, payout: out.payout };
  },
  dice: (g) => (i) => {
    const selection = validateSelection(g, { target: 50, mode: 'under' }, 1000);
    const out = ENGINES.dice.run({ stake: 1000, selection, game: g, rng: new Rng(`rtp|dice|${i}`) });
    return { stake: 1000, payout: out.payout };
  },
  mines: (g) => (i) => {
    // Three blind picks, then bank. Blind matters: peeking at state.mines makes
    // the strategy unbeatable and tells you nothing about the game.
    const stake = 1000;
    const selection = validateSelection(g, { mines: 3 }, stake);
    let out = ENGINES.mines.run({ stake, selection, game: g, rng: new Rng(`rtp|mines|${i}`) });
    const picks = new Rng(`rtp|mines|pick|${i}`).shuffle(Array.from({ length: MINES_CELLS }, (_, c) => c)).slice(0, 3);
    for (const cell of picks) {
      out = ENGINES.mines.actions({ state: out.state, action: 'pick', selection: { cell } });
      if (out.status !== 'pending') return { stake, payout: out.payout || 0 };
    }
    const cashed = ENGINES.mines.actions({ state: out.state, action: 'cashout', selection: {} });
    return { stake, payout: cashed.payout || 0 };
  },
  wheel: (g) => (i) => {
    const stake = 1000;
    const target = WHEEL_TARGETS[(i * 7) % WHEEL_TARGETS.length];
    const selection = validateSelection(g, { target }, stake);
    const out = ENGINES.wheel.run({ stake, selection, game: g, rng: new Rng(`rtp|wheel|${i}`) });
    return { stake, payout: out.payout };
  },
  plinko: (g) => (i) => {
    const stake = 1000;
    const risk = Object.keys(PLINKO_TABLES)[i % 3];
    const out = ENGINES.plinko.run({ stake, selection: { risk }, game: g, rng: new Rng(`rtp|plinko|${i}`) });
    return { stake, payout: out.payout };
  },
  bingo: (g) => (i) => {
    const out = ENGINES.bingo.run({ stake: 1000, selection: {}, game: g, rng: new Rng(`rtp|bingo|${i}`) });
    return { stake: 1000, payout: out.payout };
  },
  baccarat: (g) => (i) => {
    const stake = 1000;
    const side = i % 2 ? 'banker' : 'player';
    const selection = validateSelection(g, { bets: [{ side, amount: stake }] }, stake);
    const out = ENGINES.baccarat.run({ stake, selection, game: g, rng: new Rng(`rtp|bac|${i}`) });
    return { stake, payout: out.payout };
  },
  three_patti: (g) => (i) => {
    const stake = 1000;
    const selection = validateSelection(g, { bets: [{ side: 'player', amount: stake }] }, stake);
    const out = ENGINES.three_patti.run({ stake, selection, game: g, rng: new Rng(`rtp|3p|${i}`) });
    return { stake, payout: out.payout };
  },
  // Both card audits use the strategy a competent player uses. A house edge is
  // only meaningful against the right play: "RTP 99.5%" for a game you misplay
  // is not a promise, and a naive policy makes the maths look broken when it is
  // not. tools/check-rtp.mjs reports the play, not a fantasy.
  blackjack: () => (i) => {
    const stake = 1000;
    let out = blackjack.init({ stake, rng: new Rng(`rtp|bj|${i}`) });
    if (out.status !== 'pending') return { stake, payout: out.payout };
    let guard = 0;
    while (out.status === 'pending' && guard < 20) {
      const idx = out.view.hands.findIndex((x) => x.active);
      const h = out.view.hands[idx < 0 ? 0 : idx];
      const dealer = out.view.dealerTotal ?? 0;
      const canDouble = h.cards.length === 2 && out.actions.includes('double');
      const soft = !!h.soft;
      const total = h.total;
      let action = 'stand';
      if (total <= 8) action = 'hit';
      else if (total === 9) action = dealer >= 3 && dealer <= 6 && canDouble ? 'double' : 'hit';
      else if (total === 10) action = dealer <= 9 && canDouble ? 'double' : 'hit';
      else if (total === 11) action = canDouble ? 'double' : 'hit';
      else if (total <= 16) action = dealer >= 2 && dealer <= 6 ? 'stand' : 'hit';
      if (soft && total === 18 && dealer >= 3 && dealer <= 6) action = canDouble ? 'double' : 'stand';
      else if (soft && total <= 17) action = total === 17 && canDouble && dealer <= 6 ? 'double' : 'hit';
      else if (soft && total >= 19) action = 'stand';
      if (out.actions.includes(action) === false && action !== 'stand' && action !== 'hit') action = 'hit';
      if (action === 'double' && !out.actions.includes('double')) action = 'hit';
      if (action === 'stand' && !out.actions.includes('stand')) action = out.actions[0] ?? 'hit';
      if (action === 'hit' && !out.actions.includes('hit')) action = out.actions[0] ?? 'stand';
      out = blackjack.act({ state: out.state, action, stake });
      guard += 1;
    }
    return { stake: out.state?.wagered ?? stake, payout: out.payout || 0 };
  },
  video_poker: () => (i) => {
    const stake = 1000;
    const start = videoPoker.init({ stake, rng: new Rng(`rtp|vp|${i}`) });
    const out = videoPoker.act({ state: start.state, action: 'draw', stake, selection: { held: vpHold(start.view.cards) } });
    return { stake, payout: out.payout || 0 };
  },
  crash: (g) => (i) => {
    // Auto-cashout at 2x, the classic "double or nothing" round.
    const stake = 1000;
    const point = crashPoint(g.seed || 'rtp-server-seed', 'rtp-client', i, g.house_edge_bps ?? 100);
    const out = settleCrashBet({ stake, crashPoint: point, cashedAt: 2 });
    return { stake, payout: out.payout };
  },
};

const rows = all('SELECT key, name, engine, config, rtp_bps, house_edge_bps, min_bet, max_bet FROM games WHERE enabled = 1 ORDER BY sort, key')
  .map(shape)
  .filter((g) => !only || g.engine === only);

console.log(`\nArenaPlay return audit — ${ITERATIONS} rounds per game (demo credits, theoretical)\n`);
console.log('game'.padEnd(22), 'engine'.padEnd(12), 'label', 'measured', 'delta', 'verdict');
console.log('-'.repeat(84));
let bad = 0;
for (const g of rows) {
  const strategy = strategies[g.engine];
  if (!strategy) {
    console.log(g.key.padEnd(22), g.engine.padEnd(12), '—', 'no audit strategy yet', '', '', 'SKIP');
    continue;
  }
  const { rtp, winRate } = loop(strategy(g));
  const label = (g.rtp_bps ?? 0) / 10000;
  const delta = rtp - label;
  const skill = SKILL_GAMES.has(g.engine);
  // The one thing that is a maths error regardless of how the hand is played:
  // a game cannot pay back more than it takes.
  const rigged = rtp > 1.0 + TOLERANCE / 2;
  const ok = rigged ? false : skill ? true : Math.abs(delta) <= TOLERANCE;
  if (!ok) bad += 1;
  console.log(
    g.key.padEnd(22),
    g.engine.padEnd(12),
    `${(label * 100).toFixed(1)}%`.padEnd(6),
    `${(rtp * 100).toFixed(1)}%`.padEnd(8),
    `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`.padEnd(8),
    rigged ? 'FAIL — pays out more than it takes' : skill ? `policy (${POLICIES[g.engine]})` : ok ? 'ok' : `FAIL (hit rate ${(winRate * 100).toFixed(1)}%)`,
  );
}
console.log(`\n${rows.length - bad}/${rows.length} games are within ${(TOLERANCE * 100).toFixed(0)}pp of the RTP their card advertises.${config.demo.mode ? '' : ' (REAL MONEY MODE — not supported)'}`);
process.exit(bad ? 1 : 0);

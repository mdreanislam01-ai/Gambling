/**
 * Game maths. Every claim the lobby makes — "provably fair", "RTP 96.5%",
 * "single-zero European wheel", "35:1 on a straight number" — is a claim about
 * these functions, so it is measured here rather than written in prose.
 *
 * Statistical assertions use fixed seed keys, so a failure is reproducible: the
 * numbers below are the distribution the engines actually produce, checked
 * against the return they advertise, with enough headroom that sampling noise
 * cannot fail CI. `npm run check:rtp` is the deep version of this file.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Rng, buildDeck, rankOf, suitOf, rankIdx } from '../src/games/rng.js';
import { ENGINES, ENGINE_KEYS, engineFor, isMultiStep, resolveInstant, validateSelection } from '../src/games/index.js';
import {
  edgeBps, edgeRate, rouletteBetPayout, rouletteGroupNumbers, rouletteNumberInfo, WHEEL_ORDER,
  dicePayoutMult, minesMultiplier, MINES_CELLS, WHEEL_SEGMENTS, WHEEL_TARGETS,
  PLINKO_ROWS, PLINKO_HALF_TABLES, PLINKO_TABLES, plinkoTable, plinkoRtp,
  BINGO_LINES, BINGO_BALLS, BINGO_CALLS, BINGO_PAYTABLE,
} from '../src/games/table.js';
import { cardTotal, evaluatePoker, VP_PAYTABLE, VP_HAND_KEYS, blackjack, baccarat, videoPoker, threePatti } from '../src/games/cards.js';
import { DEFAULT_SLOT_CONFIG, paylinesFor, evaluateGrid, spinGrid, rawRtp, calibrate, targetRtp } from '../src/games/reels.js';
import { crashPoint, settleCrashBet, multiplierAt, timeForMultiplier, CRASH_MIN, CRASH_MAX } from '../src/games/crash.js';

/** A shaped catalogue row, exactly as services/bets.js hands it to an engine. */
const row = (engine, extra = {}) => ({
  engine, key: `${engine}-test`, name_key: `game.${engine}`, category: 'test',
  houseEdgeBps: 400, rtpBps: 9600, minBet: 100, maxBet: 500000, config: {}, ...extra,
});
const play = (engine, stake, selection, extra = {}, seed = 'probe') => ENGINES[engine].run({ stake, selection, game: row(engine, extra), rng: new Rng(seed) });

/** Sample a one-shot engine. Returns the fraction of the handle returned. */
function measure(engine, { stake = 1000, selection = {}, extra = {}, iterations = 4000 } = {}) {
  let paid = 0;
  let won = 0;
  for (let i = 0; i < iterations; i += 1) {
    const out = play(engine, stake, selection, extra, `${engine}|measure|${i}`);
    paid += out.payout || 0;
    if ((out.payout || 0) > stake) won += 1;
  }
  return { rtp: paid / (stake * iterations), winRate: won / iterations };
}

describe('provably fair means reproducible', () => {
  const selections = {
    slots: () => ({}),
    roulette: () => ({ bets: [{ type: 'red', amount: 1000 }] }),
    dice: () => validateSelection(row('dice'), { target: 50, mode: 'under' }, 1000),
    wheel: () => ({ target: 2 }),
    plinko: () => ({ risk: 'medium' }),
    bingo: () => ({}),
    baccarat: () => ({ bets: [{ side: 'player', amount: 1000 }] }),
    three_patti: () => ({ bets: [{ side: 'player', amount: 1000 }] }),
  };

  for (const [engine, selection] of Object.entries(selections)) {
    it(`${engine} replays from the committed seed and moves when it changes`, () => {
      const base = { game: row(engine), stake: 1000, selection: selection(), seedKey: 'server-seed-hash', nonce: 41, clientSeed: 'player' };
      const once = JSON.stringify(resolveInstant(base));
      assert.equal(once, JSON.stringify(resolveInstant(base)), 'the same seed material must give the same round');
      assert.notEqual(once, JSON.stringify(resolveInstant({ ...base, nonce: 42 })), 'the nonce must matter');
      assert.notEqual(once, JSON.stringify(resolveInstant({ ...base, clientSeed: 'someone-else' })), "the player's own seed must matter");
      assert.ok(JSON.parse(once).outcome, 'every result carries the data a verifier recomputes');
    });
  }

  it('the API path is the engine path, not a second implementation', () => {
    const selection = { target: 60, mode: 'over' };
    const viaApi = resolveInstant({ game: row('dice'), stake: 1000, selection, seedKey: 'ss', nonce: 3, clientSeed: 'me' });
    const direct = ENGINES.dice.run({ stake: 1000, selection, game: row('dice'), rng: new Rng('ss|3|me') });
    assert.deepEqual(viaApi, direct);
  });

  it('the house edge is read from both row shapes', () => {
    assert.equal(edgeBps(row('dice', { houseEdgeBps: 250 })), 250, 'camelCase from catalog.shape()');
    assert.equal(edgeBps({ house_edge_bps: 250 }), 250, 'snake_case from the DB row');
    assert.equal(edgeBps({}, 400), 400, 'the engine default when the row is silent');
    assert.equal(edgeBps({ houseEdgeBps: -50 }, 100), 0, 'a negative edge is not a player bonus');
    assert.equal(edgeBps({ houseEdgeBps: 999999 }, 100), 2000, 'capped, so an admin typo cannot gut the demo');
    assert.equal(edgeBps({ houseEdgeBps: 'nonsense' }, 150), 150, 'garbage falls back, it is not read as zero');
    assert.equal(edgeRate({ houseEdgeBps: 250 }), 0.025);
  });
});

describe('roulette is a real single-zero wheel', () => {
  it('has 37 numbers, one green zero, 18 of each colour', () => {
    const info = [...Array(37).keys()].map(rouletteNumberInfo);
    assert.equal(info.length, 37);
    assert.equal(info.filter((x) => x.colour === 'green').length, 1);
    assert.equal(info.filter((x) => x.colour === 'red').length, 18);
    assert.equal(info.filter((x) => x.colour === 'black').length, 18);
    assert.equal(info.filter((x) => x.parity === 'none').length, 1, 'zero is neither red nor black nor odd nor even');
    assert.equal(rouletteNumberInfo(0).dozen, 0);
    assert.equal(rouletteNumberInfo(1).column, 1);
    assert.equal(rouletteNumberInfo(36).column, 3);
    assert.equal(rouletteNumberInfo(13).dozen, 2);
    assert.equal(rouletteNumberInfo(32).colour, 'red');
    assert.equal(rouletteNumberInfo(15).colour, 'black');
    // The spin order is the physical wheel, so history charts read true neighbours.
    assert.equal(WHEEL_ORDER.length, 37);
    assert.equal(new Set(WHEEL_ORDER).size, 37);
    assert.deepEqual([...WHEEL_ORDER].sort((a, b) => a - b), [...Array(37).keys()]);
  });

  it('pays total return on every bet type', () => {
    const pay = (type, numbers, value, n) => rouletteBetPayout(type, numbers, value, n);
    assert.deepEqual(pay('straight', [17], null, 17), { won: true, mult: 36 }, '35:1 plus the stake back');
    assert.deepEqual(pay('straight', [17], null, 18), { won: false, mult: 36 });
    assert.equal(pay('split', [17, 18], null, 18).mult, 12);
    assert.equal(pay('street', [16, 17, 18], null, 17).won, true);
    assert.equal(pay('corner', [16, 17, 19, 20], null, 19).mult, 9);
    assert.equal(pay('sixline', [1, 2, 3, 4, 5, 6], null, 5).mult, 6);
    assert.equal(pay('red', [], null, 32).won, true);
    assert.equal(pay('red', [], null, 0).won, false, 'zero takes the even-money bets');
    assert.equal(pay('black', [], null, 32).won, false);
    assert.equal(pay('odd', [], null, 17).mult, 2);
    assert.equal(pay('even', [], null, 2).mult, 2);
    assert.equal(pay('low', [], null, 18).won, true);
    assert.equal(pay('high', [], null, 18).won, false);
    assert.equal(pay('dozen', [], 3, 25).won, true);
    assert.equal(pay('dozen', [], 1, 25).won, false);
    assert.equal(pay('column', [], 1, 25).won, true);
    assert.deepEqual(pay('la partage', [], null, 32), { won: false, mult: 0, error: 'game.bet_type_unknown' });
  });

  it('only builds inside bets the layout can physically hold', () => {
    assert.deepEqual(rouletteGroupNumbers('straight', 0), [0]);
    assert.deepEqual(rouletteGroupNumbers('split', 2), [2, 3]);
    assert.equal(rouletteGroupNumbers('split', 3), null, 'no split across a row end');
    assert.deepEqual(rouletteGroupNumbers('street', 4), [4, 5, 6]);
    assert.deepEqual(rouletteGroupNumbers('corner', 1), [1, 2, 4, 5]);
    assert.equal(rouletteGroupNumbers('corner', 3), null, 'no corner past the third column');
    assert.deepEqual(rouletteGroupNumbers('sixline', 1), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(rouletteGroupNumbers('sixline', 33), [31, 32, 33, 34, 35, 36], 'the line is anchored to its row start');
    assert.equal(rouletteGroupNumbers('sixline', 34), null);
    assert.equal(rouletteGroupNumbers('street', 99), null, 'out of range');
    assert.equal(rouletteGroupNumbers('red', 5), null, 'group numbers are for inside bets only');
  });

  it('covering the whole wheel costs 37 and returns 36', () => {
    for (let i = 0; i < 60; i += 1) {
      const bets = [...Array(37).keys()].map((n) => ({ type: 'straight', numbers: [n], amount: 1000 }));
      const out = play('roulette', 37000, { bets }, {}, `cover|${i}`);
      assert.equal(out.payout, 36000, 'exactly one number can win');
      assert.equal(out.outcome.legs.filter((l) => l.won).length, 1);
      assert.deepEqual(out.outcome.info, rouletteNumberInfo(out.outcome.number), 'the announced colour matches the number');
    }
  });

  it('keeps the 2.70% that a single zero is worth', () => {
    const { rtp } = measure('roulette', { selection: { bets: [{ type: 'red', amount: 1000 }] } });
    assert.ok(Math.abs(rtp - 36 / 37) < 0.06, `red returned ${(rtp * 100).toFixed(1)}%, expected ${(36 / 37 * 100).toFixed(1)}%`);
  });

  it('validates the slip against the stake, not against hope', () => {
    assert.throws(() => ENGINES.roulette.validate({}, 1000), (e) => e.status === 400 && e.code === 'err.bets_required');
    assert.throws(() => ENGINES.roulette.validate({ bets: [{ type: 'red', amount: 900 }] }, 1000), (e) => e.code === 'err.bets_stake_mismatch');
    assert.throws(() => ENGINES.roulette.validate({ bets: [{ type: 'straight', numbers: [], amount: 1000 }] }, 1000), (e) => e.code === 'err.bet_numbers_required');
    assert.throws(() => ENGINES.roulette.validate({ bets: [{ type: 'dozen', value: 9, amount: 1000 }] }, 1000), (e) => e.code === 'err.bet_value_invalid');
    const ok = ENGINES.roulette.validate({ bets: [{ type: 'straight', numbers: [7], amount: 600 }, { type: 'red', amount: 400 }] }, 1000);
    assert.equal(ok.bets.length, 2);
    assert.equal(ok.bets.reduce((a, b) => a + b.amount, 0), 1000);
    assert.equal(ENGINES.roulette.validate({ bets: [{ type: 'straight', numbers: [5], amount: 1000 }, { type: 'red', amount: 0 }] }, 1000).bets.length, 1, 'zero-amount legs are dropped, not settled');
  });
});

describe('dice', () => {
  it('prices the inverse of the chance minus the edge', () => {
    assert.equal(dicePayoutMult('under', 50, 0.01), 1.98);
    assert.equal(dicePayoutMult('under', 50, 0), 2);
    assert.equal(dicePayoutMult('equal', 50, 0), 100);
    for (const target of [2, 25, 50, 75, 98]) {
      for (const mode of ['under', 'over']) {
        // roll is an integer 0..99: under hits `target` values, over hits 99-target.
        const chance = mode === 'under' ? target / 100 : (99 - target) / 100;
        const mult = dicePayoutMult(mode, target, 0.04);
        const rtp = mult * chance;
        assert.ok(rtp <= 1, `${mode} ${target} pays ${mult.toFixed(3)} on a ${(chance * 100).toFixed(0)}% chance`);
        assert.ok(rtp > 0.9, `${mode} ${target} is too thin: ${(rtp * 100).toFixed(1)}%`);
      }
    }
    assert.equal(dicePayoutMult('under', 0, 0.01), 0, 'a bet that cannot win is not priced');
  });

  it('rolls 0-99 and pays exactly the announced rule', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) {
      const selection = validateSelection(row('dice'), { target: 50, mode: 'under' }, 1000);
      const out = play('dice', 1000, selection, {}, `dice|${i}`);
      const { roll } = out.outcome;
      seen.add(roll);
      assert.ok(Number.isInteger(roll) && roll >= 0 && roll <= 99, `roll ${roll}`);
      assert.equal(out.payout > 0, roll < 50);
      if (roll < 50) assert.equal(out.payout, Math.floor(1000 * dicePayoutMult('under', 50, 0.04)));
    }
    assert.ok(seen.size > 55, `only ${seen.size} distinct rolls in 400 spins`);
    assert.ok(seen.has(0) && seen.has(99), 'both ends of the range must be reachable');
    const { rtp } = measure('dice', { selection: { target: 50, mode: 'under' } });
    assert.ok(rtp > 0.92 && rtp < 1.005, `dice returned ${(rtp * 100).toFixed(1)}%`);
  });

  it('clamps an impossible target instead of trusting the client', () => {
    assert.deepEqual(validateSelection(row('dice'), { target: 1, mode: 'under' }), { mode: 'under', target: 2 });
    assert.deepEqual(validateSelection(row('dice'), { target: 999 }), { mode: 'under', target: 98 });
    assert.deepEqual(validateSelection(row('dice'), { target: 60, mode: 'sideways' }), { mode: 'under', target: 60 });
    assert.equal(validateSelection(row('dice'), { target: 33.6, mode: 'over' }).target, 34);
    assert.equal(validateSelection(row('dice'), { target: -20, mode: 'equal' }).mode, 'equal');
  });
});

describe('mines', () => {
  it('multiplies by the exact inverse survival chance', () => {
    assert.equal(minesMultiplier(3, 1, 0.01), 0.99 / (22 / 25));
    assert.equal(Math.round(minesMultiplier(3, 2, 0.01) * 1e9), Math.round((0.99 / ((22 / 25) * (21 / 24))) * 1e9));
    for (const mines of [1, 3, 10, 24]) {
      let prev = 0;
      for (let picks = 1; picks <= Math.min(6, MINES_CELLS - mines); picks += 1) {
        const m = minesMultiplier(mines, picks, 0.01);
        assert.ok(m > prev, `with ${mines} mines, pick ${picks} must beat ${picks - 1}`);
        prev = m;
      }
    }
    assert.ok(minesMultiplier(24, 1, 0.01) > 24, 'one pick out of 25 squares is a 25x event');
    assert.equal(minesMultiplier(24, 24, 0.01), 0, 'clearing a board that cannot be cleared pays nothing');
  });

  it('busts on a mine, banks on a cashout, then closes the round', () => {
    const start = play('mines', 1000, { mines: 3 }, {}, 'mines|flow');
    assert.equal(start.status, 'pending');
    assert.deepEqual(start.actions, ['pick', 'cashout']);
    assert.equal(start.view.safeCells, MINES_CELLS - 3);
    const mines = new Set(start.state.mines);
    assert.equal(mines.size, 3, 'three mines are placed');
    assert.ok([...mines].every((c) => c >= 0 && c < MINES_CELLS));
    const safe = [...Array(MINES_CELLS).keys()].filter((c) => !mines.has(c));
    // act() writes into the state it is given, so each error case needs its own
    // fresh round instead of a stale one that has already been cashed out.
    const fresh = () => play('mines', 1000, { mines: 3 }, {}, 'mines|flow').state;
    // The engine reads the edge from the row it was given, so the test must too.
    const edge = edgeRate(row('mines'), 100);
    const first = ENGINES.mines.actions({ state: start.state, action: 'pick', selection: { cell: safe[0] } });
    assert.equal(first.status, 'pending');
    assert.equal(first.view.multiplier, minesMultiplier(3, 1, edge));
    const second = ENGINES.mines.actions({ state: first.state, action: 'pick', selection: { cell: safe[1] } });
    const cashed = ENGINES.mines.actions({ state: second.state, action: 'cashout', selection: {} });
    assert.equal(cashed.status, 'cashout');
    assert.equal(cashed.payout, Math.floor(1000 * minesMultiplier(3, 2, edge)));
    assert.ok(cashed.payout > 1000, 'cashing after two safe picks pays more than the stake');
    assert.deepEqual(cashed.outcome.picks, [safe[0], safe[1]], 'the verified result lists the picks');
    assert.equal(ENGINES.mines.actions({ state: cashed.state, action: 'pick', selection: { cell: safe[2] } }).error, 'err.round_closed', 'a cashed-out hand is closed');
    const bust = ENGINES.mines.actions({ state: fresh(), action: 'pick', selection: { cell: [...mines][0] } });
    assert.equal(bust.status, 'lost');
    assert.equal(bust.payout, 0, 'a mine takes the stake, it does not refund it');
    assert.equal(bust.outcome.hit, [...mines][0]);
    assert.equal(ENGINES.mines.actions({ state: fresh(), action: 'cashout', selection: {} }).error, 'err.pick_required');
    assert.equal(ENGINES.mines.actions({ state: fresh(), action: 'pick', selection: { cell: 99 } }).error, 'err.cell_invalid');
    assert.equal(ENGINES.mines.actions({ state: fresh(), action: 'dig', selection: { cell: 1 } }).error, 'err.action_unknown');
  });

  it('an abandoned hand is played out by the timeout, not refunded blind', () => {
    const start = play('mines', 1000, { mines: 5 }, {}, 'mines|timeout');
    assert.equal(typeof ENGINES.mines.timeout, 'function');
    const settled = ENGINES.mines.timeout({ ...start.state, mines: start.state.mines });
    assert.ok(['lost', 'cashout', 'won', 'void'].includes(settled.status ?? 'lost'));
  });

  it('clamps the mine count server-side', () => {
    assert.equal(validateSelection(row('mines'), { mines: 0 }).mines, 3, 'zero mines is not a game, so it falls back to the default');
    assert.equal(validateSelection(row('mines'), { mines: 99 }).mines, 24);
    assert.equal(validateSelection(row('mines'), {}).mines, 3);
    assert.equal(validateSelection(row('mines'), { mines: 3.7 }).mines, 4);
  });
});

describe('wheel', () => {
  it('can never pay more than the wheel can fund', () => {
    for (const target of WHEEL_TARGETS) {
      for (const edge of [0, 100, 400, 1200]) {
        const out = ENGINES.wheel.run({ stake: 1000, selection: { target }, game: row('wheel', { houseEdgeBps: edge }), rng: new Rng(`invariant|${target}|${edge}`) });
        const { segments, subSlots, winningSlots } = out.outcome;
        const total = segments * subSlots;
        assert.ok(winningSlots >= 1, `${target}x must be reachable`);
        assert.ok(winningSlots <= total - 1, `${target}x at ${(out.outcome.rtpBps / 100).toFixed(1)}% is a guaranteed win`);
        assert.ok(out.outcome.rtpBps <= 10000, `${target}x advertises ${out.outcome.rtpBps / 100}%`);
        assert.ok(out.outcome.segment >= 0 && out.outcome.segment < segments);
        if (out.outcome.hit) assert.equal(out.payout, Math.floor(1000 * target), 'the player is paid the multiplier they called');
        else assert.equal(out.payout, 0);
      }
    }
  });

  it('measured returns sit at or under the advertised RTP for every target', () => {
    for (const target of WHEEL_TARGETS) {
      const iterations = target >= 10 ? 12000 : 4000;
      const { rtp } = measure('wheel', { selection: { target }, iterations });
      assert.ok(rtp < 1.02, `the ${target}x wheel returned ${(rtp * 100).toFixed(1)}% — the edge vanished`);
      assert.ok(rtp > 0.78, `the ${target}x wheel returned only ${(rtp * 100).toFixed(1)}%`);
    }
  });

  it('deals winning slices evenly, so no slice is luckier than its neighbour', () => {
    const counts = new Array(WHEEL_SEGMENTS).fill(0);
    for (let i = 0; i < 20000; i += 1) {
      const out = play('wheel', 1000, { target: 3 }, {}, `spread|${i}`);
      if (out.outcome.hit) counts[out.outcome.segment] += 1;
    }
    const total = counts.reduce((a, b) => a + b, 0);
    assert.ok(total > 200, 'the 3x target must be hit often enough to judge');
    const mean = total / WHEEL_SEGMENTS;
    for (const c of counts) {
      assert.ok(c > mean * 0.5 && c < mean * 1.5, `slice counts look skewed: ${counts.join(',')}`);
    }
  });

  it('falls back to a legal target when the client sends junk', () => {
    assert.deepEqual(validateSelection(row('wheel'), { target: 7 }), { target: 2 });
    assert.deepEqual(validateSelection(row('wheel'), { target: 10 }), { target: 10 });
    assert.equal(play('wheel', 1000, { target: 7 }, {}, 'junk').outcome.target, 2);
  });
});

describe('plinko', () => {
  it('mirrors a half table into buckets and walks one row per peg', () => {
    for (const risk of Object.keys(PLINKO_HALF_TABLES)) {
      const half = PLINKO_HALF_TABLES[risk];
      const table = plinkoTable(risk);
      assert.equal(table.length, PLINKO_ROWS + 1, '12 rows have 13 exits');
      assert.deepEqual(table, PLINKO_TABLES[risk]);
      for (let i = 0; i < table.length; i += 1) assert.equal(table[i], table[table.length - 1 - i], `${risk} must be symmetric`);
      assert.ok(table[0] === Math.max(...table), 'the edge bucket is the jackpot');
      const out = play('plinko', 1000, { risk }, {}, `plinko|${risk}`);
      assert.equal(out.outcome.path.length, PLINKO_ROWS);
      assert.ok(out.outcome.path.every((p) => p === 0 || p === 1), 'each row is one binary bounce');
      assert.equal(out.outcome.bucket, out.outcome.path.reduce((a, b) => a + b, 0));
      assert.equal(out.payout, Math.floor(1000 * table[out.outcome.bucket]));
      assert.equal(out.status, out.payout > 1000 ? 'won' : out.payout === 1000 ? 'void' : 'lost');
    }
    assert.deepEqual(plinkoTable('nonsense'), plinkoTable('medium'), 'an unknown risk level still plays');
  });

  it('every risk level returns what the card claims, by exact binomial maths', () => {
    for (const risk of Object.keys(PLINKO_TABLES)) {
      const analytic = plinkoRtp(PLINKO_TABLES[risk]);
      assert.ok(analytic > 0.9 && analytic < 1.0, `${risk} returns ${(analytic * 100).toFixed(1)}% by construction`);
      const { rtp } = measure('plinko', { selection: { risk }, iterations: 6000 });
      assert.ok(Math.abs(rtp - analytic) < 0.05, `${risk}: measured ${(rtp * 100).toFixed(1)}% vs analytic ${(analytic * 100).toFixed(1)}%`);
    }
  });
});

describe('slots', () => {
  it('pays exactly what the paytable says for a line of symbols', () => {
    const config = { ...DEFAULT_SLOT_CONFIG };
    const byKey = Object.fromEntries(config.symbols.map((s) => [s.key, s]));
    // A payline is one cell per reel, so three sevens means sevens on row 0.
    const grid = [['seven', 'lemon', 'bell'], ['seven', 'lemon', 'bell'], ['seven', 'lemon', 'bell']];
    const win = evaluateGrid(grid, config, 1);
    assert.ok(win.totalLineMultiplier >= byKey.seven.pays[3], 'three sevens pay the top prize');
    assert.ok(win.wins.every((w) => w.count >= 2 && w.multiplier > 0));
    assert.equal(win.totalLineMultiplier, win.wins.reduce((a, w) => a + w.multiplier, 0));
    // No row and neither diagonal may line up two of anything here.
    const junk = evaluateGrid([['lemon', 'grape', 'cherry'], ['cherry', 'lemon', 'bell'], ['bell', 'gold', 'grape']], config, 1);
    assert.equal(junk.totalLineMultiplier, 0, `junk grid paid ${junk.totalLineMultiplier}: ${JSON.stringify(junk.wins)}`);
    const wilded = evaluateGrid([['wild', 'lemon', 'bell'], ['seven', 'lemon', 'bell'], ['seven', 'lemon', 'bell']], config, 1);
    assert.ok(wilded.wins.some((w) => w.symbol === 'seven' && w.count === 3), 'a wild at the start still counts as sevens');
    const scatters = evaluateGrid([['scatter', 'lemon', 'bell'], ['scatter', 'lemon', 'bell'], ['lemon', 'lemon', 'bell']], config, 1);
    assert.equal(scatters.scatters, 2, 'scatters count anywhere on the grid');
  });

  it('scales the paytable so the game pays its advertised RTP', () => {
    const config = { ...DEFAULT_SLOT_CONFIG };
    const raw = rawRtp(config);
    assert.ok(raw > 0.5 && raw < 5, `raw expectation ${raw.toFixed(3)}`);
    for (const rtp of [9200, 9600, 9700]) {
      const game = { engine: 'slots', rtp_bps: rtp, config };
      const calibrated = calibrate(config, game);
      const scaled = evaluateGrid(spinGrid(new Rng('scale'), { ...config, ...calibrated }), calibrated, calibrated.payScale);
      assert.ok(Number.isFinite(scaled.totalLineMultiplier));
      let paid = 0;
      const stake = 100000;
      const iterations = 15000;
      for (let i = 0; i < iterations; i += 1) paid += ENGINES.slots.run({ stake, selection: {}, game, rng: new Rng(`cal|${rtp}|${i}`) }).payout;
      const measured = paid / (stake * iterations);
      assert.ok(Math.abs(measured - rtp / 10000) < 0.06, `${rtp / 100}% measured ${(measured * 100).toFixed(1)}%`);
      assert.ok(Math.abs(calibrated.payScale * raw - rtp / 10000) < 1e-3, 'the scale is the label over the raw expectation');
    }
    assert.equal(targetRtp({}), 0.96, 'a row with no label still says something honest');
    assert.equal(targetRtp({ house_edge_bps: 500 }), 0.95, 'otherwise the edge decides');
  });

  it('plays the number of lines it says it plays', () => {
    assert.equal(paylinesFor({ reels: 3, rows: 3, lines: 3 }).length, 3);
    assert.equal(paylinesFor({ reels: 3, rows: 3, lines: 5 }).length, 5);
    assert.equal(paylinesFor({ reels: 3, rows: 3, lines: 99 }).length, 5, 'a 3-reel layout has five lines, full stop');
    assert.equal(paylinesFor({ reels: 5, rows: 3, lines: 4 }).length, 4);
    assert.equal(paylinesFor({ reels: 5, rows: 3, lines: 9 }).length, 5, 'a 5×3 layout only has five lines to play');
    assert.equal(paylinesFor({ reels: 5, rows: 4, lines: 9 }).length, 6);
    assert.equal(paylinesFor({ reels: 5, rows: 3, lines: 999 }).length, 5, 'asking for more lines than exist is not a bonus');
    // The stake is divided across the lines that are played, so the line count can
    // never silently multiply the return.
    const game = { engine: 'slots', rtp_bps: 9600, config: { ...DEFAULT_SLOT_CONFIG, reels: 5, rows: 3, lines: 20 } };
    const out = ENGINES.slots.run({ stake: 20000, selection: {}, game, rng: new Rng('lines|20') });
    assert.equal(out.outcome.lines, 5);
    assert.equal(out.outcome.perLine, 4000, 'the stake is split across the lines that exist');
  });

  it('grants free spins from scatters and pays them at the bonus multiplier', () => {
    const withBonus = { engine: 'slots', rtp_bps: 9600, config: { ...DEFAULT_SLOT_CONFIG, freeSpins: { scatterMin: 1, spins: 3, multiplier: 2 } } };
    let awarded = 0;
    for (let i = 0; i < 400; i += 1) {
      const out = ENGINES.slots.run({ stake: 1000, selection: {}, game: withBonus, rng: new Rng(`fs|${i}`) });
      if (out.outcome.freeSpinsAwarded) {
        awarded += 1;
        assert.equal(out.outcome.freeSpinsAwarded, 3);
        assert.ok(out.outcome.spins.length > 1, 'the bonus spins are part of the settled result');
        assert.ok(out.outcome.spins.some((s) => s.free), 'bonus spins are flagged as free');
      }
      assert.ok(Number.isInteger(out.payout) && out.payout >= 0);
    }
    // One scatter across nine cells at a ~5% weight is a ~35% event, not a given.
    assert.ok(awarded > 80 && awarded < 250, `scatter trigger rate was ${awarded}/400`);
    const noBonus = { engine: 'slots', rtp_bps: 9600, config: { ...DEFAULT_SLOT_CONFIG, freeSpins: null } };
    for (let i = 0; i < 200; i += 1) {
      const out = ENGINES.slots.run({ stake: 1000, selection: {}, game: noBonus, rng: new Rng(`nb|${i}`) });
      assert.equal(out.outcome.freeSpinsAwarded, 0, 'a game without a bonus never invents one');
      assert.equal(out.outcome.spins.length, 1);
    }
  });
});

describe('blackjack', () => {
  it('values an ace as 11 until it would bust', () => {
    assert.deepEqual(cardTotal(['AS', 'KH']), { total: 21, soft: true });
    assert.equal(cardTotal(['AS', 'KH', '9D']).total, 20);
    assert.equal(cardTotal(['AS', 'KH', '9D']).soft, false);
    assert.equal(cardTotal(['AS', 'AH']).total, 12);
    assert.equal(cardTotal(['AS', 'AH', 'AC']).total, 13);
    assert.equal(cardTotal([]).total, 0);
    assert.equal(cardTotal(['10S', 'JD', 'QC', 'KS']).total, 40);
  });

  it('deals two to the player, hides the hole card, and offers legal actions', () => {
    const out = blackjack.init({ stake: 1000, rng: new Rng('bj|flow') });
    assert.equal(out.status, 'pending');
    assert.equal(out.view.hands.length, 1);
    assert.equal(out.view.hands[0].cards.length, 2);
    assert.equal(out.view.dealer.length, 2);
    assert.equal(out.view.dealer[1].hidden, true, 'the hole card stays face down during the player turn');
    assert.deepEqual(out.actions, ['hit', 'stand', 'double'], 'two cards means double is available');
    assert.ok(!out.actions.includes('insurance'), 'this table does not offer insurance, and the house rules say so');
    const hit = blackjack.act({ state: out.state, action: 'hit', stake: 1000 });
    assert.equal(hit.view.hands[0].cards.length, 3);
    if (hit.actions) assert.ok(!hit.actions.includes('double'), 'you cannot double after taking a card');
    const freshBj = blackjack.init({ stake: 1000, rng: new Rng('bj|flow') });
    assert.equal(blackjack.act({ state: freshBj.state, action: 'sit', stake: 1000 }).error, 'err.action_unknown');
    assert.ok(Array.isArray(freshBj.state.hands) && freshBj.state.hands.length === 1);
  });

  it('pays 3:2 on a natural, pushes both naturals, and takes a dealer-only natural', () => {
    let natural = 0;
    let both = 0;
    let dealerOnly = 0;
    let won = 0;
    let lost = 0;
    let push = 0;
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 1500; i += 1) {
      const start = blackjack.init({ stake: 1000, rng: new Rng(`bj|sweep|${i}`) });
      wagered += 1000;
      if (start.status !== 'pending') {
        const result = start.outcome.results[0];
        paid += start.payout;
        if (result.natural) {
          natural += 1;
          assert.equal(start.payout, 1000 + 1500, 'a natural pays three halves');
          assert.equal(start.status, 'won');
        } else if (start.status === 'void') {
          both += 1;
          assert.equal(start.payout, 1000, 'both naturals is a push, not a win');
        } else {
          dealerOnly += 1;
          assert.equal(start.payout, 0);
        }
        continue;
      }
      let cur = start;
      let guard = 0;
      while (cur.status === 'pending' && guard < 16) {
        const idx = Math.max(0, cur.view.hands.findIndex((h) => h.active));
        const hand = cur.view.hands[idx];
        const dealer = cur.view.dealerTotal ?? 0;
        const action = !hand.soft && hand.total <= 11 ? 'hit' : hand.total >= 17 ? 'stand' : dealer <= 6 ? 'stand' : 'hit';
        cur = blackjack.act({ state: cur.state, action: cur.actions.includes(action) ? action : (cur.actions[0] ?? 'stand'), stake: 1000 });
        guard += 1;
      }
      paid += cur.payout || 0;
      if (cur.status === 'won') won += 1;
      else if (cur.status === 'void') push += 1;
      else lost += 1;
      assert.ok(guard < 16, 'the hand must terminate');
      assert.ok(cur.view.dealer.every((c) => !c.hidden), 'the hole card is revealed at settlement');
    }
    assert.ok(natural > 30, `naturals: ${natural}/1500`);
    assert.ok(both > 0 || dealerOnly > 0, 'the dealer must sometimes hold a natural too');
    assert.ok(won > 200 && lost > 200 && push > 30, `outcomes should all happen: w${won} l${lost} p${push}`);
    const rtp = paid / wagered;
    assert.ok(rtp > 0.88 && rtp < 1.0, `blackjack returned ${(rtp * 100).toFixed(1)}% for this policy`);
  });

  it('doubling doubles the wager, splitting makes two hands, and neither is free', () => {
    let seen = 0;
    for (let i = 0; i < 400 && seen < 2; i += 1) {
      const start = blackjack.init({ stake: 1000, rng: new Rng(`bj|action|${i}`) });
      if (start.status !== 'pending') continue;
      const doubled = blackjack.act({ state: { ...start.state, hands: start.state.hands.map((h) => ({ ...h, cards: ['5S', '6H'] })) }, action: 'double', stake: 1000 });
      if (!doubled.error) {
        seen += 1;
        assert.equal(doubled.state.wagered, 2000, 'the extra stake is part of the hand');
        assert.equal(doubled.view.hands[0].doubled, true);
        assert.equal(doubled.view.hands[0].bet, 2000);
      }
      const split = blackjack.act({ state: start.state, action: 'split', stake: 1000 });
      if (!split.error && split.state) {
        assert.equal(split.state.hands.length, 2);
        assert.equal(split.state.wagered, 2000);
        const again = blackjack.act({ state: split.state, action: 'split', stake: 1000 });
        assert.equal(again.error, 'err.action_not_allowed', 'one split per hand, as the house rules say');
      }
    }
    assert.ok(seen > 0, 'the double path must be exercised');
  });

  it('plays an abandoned hand out instead of refunding a winner', () => {
    const out = blackjack.init({ stake: 1000, rng: new Rng('bj|timeout') });
    const settled = blackjack.timeout(out.state);
    assert.ok(['won', 'lost', 'void'].includes(settled.status), settled.status);
    assert.ok(Number.isInteger(settled.payout) && settled.payout >= 0);
    assert.ok(settled.payout === 0 || settled.payout >= 1000, 'a played-out hand either wins something or loses the stake');
    assert.equal(blackjack.act({ state: settled.state, action: 'hit', stake: 1000 }).error, 'err.hand_closed');
  });
});

describe('video poker is Jacks or Better, as named', () => {
  it('ranks every hand', () => {
    assert.equal(evaluatePoker(['AS', 'KS', 'QS', 'JS', '10S']), 'royal_flush');
    assert.equal(evaluatePoker(['9S', '8S', '7S', '6S', '5S']), 'straight_flush');
    assert.equal(evaluatePoker(['7S', '7H', '7D', '7C', '2S']), 'four');
    assert.equal(evaluatePoker(['8S', '8H', '8D', '4C', '4S']), 'full_house');
    assert.equal(evaluatePoker(['AD', '9D', '6D', '4D', '2D']), 'flush');
    assert.equal(evaluatePoker(['6S', '5H', '4D', '3C', '2S']), 'straight');
    assert.equal(evaluatePoker(['AC', '2D', '3S', '4H', '5C']), 'straight', 'the wheel counts as a straight');
    assert.equal(evaluatePoker(['QS', 'QH', 'QD', '9C', '4S']), 'three');
    assert.equal(evaluatePoker(['JS', 'JH', '9D', '9C', '4S']), 'two_pair');
    assert.equal(evaluatePoker(['JS', 'JH', '9D', '7C', '4S']), 'jacks');
    assert.equal(evaluatePoker(['10S', '10H', '9D', '7C', '4S']), 'none', 'a pair under jacks does not pay');
    assert.equal(evaluatePoker(['QS', 'QH', '9D', '7C', '4S']), 'jacks', 'queens are better than jacks, so they pay');
    assert.equal(evaluatePoker(['KS', 'KH', '9D', '7C', '4S']), 'jacks');
    assert.equal(VP_PAYTABLE.royal_flush, 250);
    assert.equal(VP_PAYTABLE.jacks, 1, 'jacks is a push at 9/6, which is why it is called Jacks or Better');
    assert.equal(VP_PAYTABLE.none, 0);
    assert.ok(VP_PAYTABLE.royal_flush > VP_PAYTABLE.straight_flush);
    assert.ok(VP_PAYTABLE.straight_flush > VP_PAYTABLE.four);
    assert.ok(VP_PAYTABLE.four > VP_PAYTABLE.full_house);
    for (const key of Object.keys(VP_PAYTABLE)) assert.ok(VP_HAND_KEYS[key], `${key} has no translated name`);
  });

  it('holds, draws the rest, and pays the paytable', () => {
    const start = videoPoker.init({ rng: new Rng('vp|flow'), stake: 1000 });
    assert.equal(start.status, 'pending');
    assert.equal(start.view.cards.length, 5);
    const held = videoPoker.act({ state: start.state, action: 'hold', selection: { held: [0, 1, 2] }, stake: 1000 });
    assert.deepEqual(held.view.held, [0, 1, 2]);
    assert.deepEqual(held.actions, ['draw']);
    const drawn = videoPoker.act({ state: held.state, action: 'draw', stake: 1000 });
    assert.equal(drawn.outcome.finalCards.length, 5);
    assert.deepEqual(drawn.outcome.finalCards.slice(0, 3), start.view.cards.slice(0, 3), 'held cards never change');
    assert.equal(drawn.payout, Math.floor(1000 * (VP_PAYTABLE[drawn.outcome.hand] ?? 0)));
    assert.equal(drawn.view.handKey, VP_HAND_KEYS[drawn.outcome.hand], 'the client gets a translatable hand name');
    assert.equal(videoPoker.act({ state: start.state, action: 'double', stake: 1000 }).error, 'err.action_unknown');
    assert.equal(videoPoker.timeout(start.state).status, 'lost', 'an abandoned draw pays nothing and is refunded as a void by the bet service');
  });

  it('stand-pat is a legal play', () => {
    const start = videoPoker.init({ rng: new Rng('vp|pat'), stake: 1000 });
    const pat = videoPoker.act({ state: start.state, action: 'hold', selection: { held: [0, 1, 2, 3, 4] }, stake: 1000 });
    assert.equal(pat.status, 'pending', 'holding all five has to be allowed or a made hand cannot be kept');
    const drawn = videoPoker.act({ state: pat.state, action: 'draw', stake: 1000 });
    assert.deepEqual(drawn.outcome.finalCards, start.view.cards, 'nothing is replaced');
    assert.equal(drawn.outcome.hand, evaluatePoker(start.view.cards));
    assert.equal(drawn.status, drawn.payout > 1000 ? 'won' : drawn.payout === 1000 && drawn.payout > 0 ? 'void' : 'lost');
  });

  it('pays the paytable over a full shoe', () => {
    const pays = {};
    let paid = 0;
    const iterations = 6000;
    for (let i = 0; i < iterations; i += 1) {
      const start = videoPoker.init({ rng: new Rng(`vp|sweep|${i}`), stake: 1000 });
      // Hold a made hand; otherwise draw five. Both are honest player policies.
      const keep = evaluatePoker(start.view.cards) === 'none' ? [] : [0, 1, 2, 3, 4];
      const out = videoPoker.act({ state: start.state, action: 'draw', stake: 1000, selection: { held: keep } });
      paid += out.payout;
      pays[out.outcome.hand] = (pays[out.outcome.hand] || 0) + 1;
      assert.ok(['won', 'void', 'lost'].includes(out.status));
    }
    const rtp = paid / (1000 * iterations);
    assert.ok(rtp > 0.25 && rtp < 1.01, `random-draw RTP ${rtp.toFixed(3)} should sit near the 9/6 table's floor`);
    assert.ok(pays.none, 'most draws miss');
    assert.ok((pays.two_pair ?? 0) > (pays.four ?? 0), 'two pair must beat quads in frequency');
  });
});

describe('baccarat and 3-patti', () => {
  it('keeps punto banco totals in range and pays its own odds', () => {
    let ties = 0;
    for (let i = 0; i < 600; i += 1) {
      const out = baccarat.init({ rng: new Rng(`bac|${i}`), selection: { bets: [{ side: 'banker', amount: 1000 }] } });
      assert.ok(out.outcome.playerTotal >= 0 && out.outcome.playerTotal <= 9, `player ${out.outcome.playerTotal}`);
      assert.ok(out.outcome.bankerTotal >= 0 && out.outcome.bankerTotal <= 9);
      const expected = out.outcome.playerTotal > out.outcome.bankerTotal ? 'player' : out.outcome.bankerTotal > out.outcome.playerTotal ? 'banker' : 'tie';
      assert.equal(out.outcome.winner, expected);
      assert.ok(out.outcome.player.length <= 3 && out.outcome.banker.length <= 3, 'at most one draw card each');
      if (out.outcome.winner === 'banker') assert.equal(out.payout, 1950, 'banker wins pay 0.95:1 after commission');
      if (out.outcome.winner === 'tie') {
        ties += 1;
        assert.equal(out.payout, 1000, 'a tie pushes banker, it does not take the stake');
        assert.equal(out.status, 'void');
      }
    }
    assert.ok(ties > 20, `ties are ${ties}/600 — the shoe is not dealing a real game`);
    for (const side of ['player', 'banker', 'tie']) {
      const { rtp } = measure('baccarat', { selection: { bets: [{ side, amount: 1000 }] }, iterations: 3000 });
      assert.ok(rtp > 0.75 && rtp < 1.01, `${side} returned ${(rtp * 100).toFixed(1)}%`);
    }
  });

  it('rejects a side that is not on the table', () => {
    assert.throws(() => validateSelection(row('baccarat'), { bets: [{ side: 'joker', amount: 100 }] }, 100), (e) => e.code === 'err.bet_side_invalid');
    assert.throws(() => validateSelection(row('baccarat'), { bets: [{ side: 'player', amount: 100 }] }, 90), (e) => e.code === 'err.bets_stake_mismatch');
    assert.throws(() => validateSelection(row('baccarat'), { bets: [] }, 100), (e) => e.code === 'err.bets_required');
    for (const side of ['banker', 'tie', 'both']) {
      assert.throws(() => validateSelection(row('three_patti'), { bets: [{ side, amount: 100 }] }, 100), (e) => e.code === 'err.bet_side_invalid', `${side} is not offered`);
    }
  });

  it('ranks 3-patti hands and pays the called side', () => {
    const ranks = {};
    for (let i = 0; i < 1500; i += 1) {
      const out = threePatti.init({ rng: new Rng(`3p|${i}`), selection: { bets: [{ side: 'player', amount: 1000 }] } });
      assert.ok(['trail', 'pure_seq', 'seq', 'color', 'pair', 'high'].includes(out.outcome.playerRank), out.outcome.playerRank);
      assert.ok(['player', 'dealer', 'tie'].includes(out.outcome.result));
      ranks[out.outcome.playerRank] = (ranks[out.outcome.playerRank] || 0) + 1;
      if (out.outcome.result === 'player') assert.equal(out.payout, 2000, 'a player win pays 1:1');
      else assert.equal(out.payout, 0, 'a tie is a loss for the player bet');
      assert.equal(out.outcome.legs[0].side, 'player');
    }
    assert.ok(ranks.high > (ranks.pair ?? 0), `high card must be more common than a pair: ${JSON.stringify(ranks)}`);
    assert.ok((ranks.trail ?? 0) < ranks.high, 'a trail is far rarer than high card');
    assert.ok((ranks.trail ?? 0) + (ranks.pure_seq ?? 0) < ranks.pair, 'both premium hands are rarer than a pair');
    // No tie side bet: an exact tie between two 3-card hands is a ~1-in-1600
    // event, and labelling it 8:1 was a promise the maths could not keep.
    assert.throws(() => validateSelection(row('three_patti'), { bets: [{ side: 'tie', amount: 1000 }] }, 1000), (e) => e.code === 'err.bet_side_invalid');
    // Pair plus by tier: 18.7% pair / 5.3% colour / 2.9% sequence / 0.6% premium,
    // priced to about 96% of the stake. Over 100% would mean the table pays out
    // more than it takes, which no amount of "it is only a demo" excuses.
    const pairPlus = measure('three_patti', { selection: { bets: [{ side: 'pair_plus', amount: 1000 }] }, iterations: 6000 });
    assert.ok(pairPlus.rtp > 0.85 && pairPlus.rtp < 1.02, `pair plus returned ${(pairPlus.rtp * 100).toFixed(1)}%`);
  });
});

describe('bingo is a card against a call list, not a guaranteed win', () => {
  it('uses a 3×3 card with a free centre and eight lines', () => {
    assert.equal(BINGO_LINES.length, 8);
    for (const line of BINGO_LINES) {
      assert.equal(line.length, 3);
      assert.ok(line.every((c) => c >= 0 && c < 9));
    }
    assert.deepEqual(BINGO_LINES[4], [1, 4, 7]);
    assert.ok(BINGO_CALLS < BINGO_BALLS, 'calling every ball would complete every card');
  });

  it('can lose, and pays per line completed', () => {
    let losses = 0;
    let wins = 0;
    for (let i = 0; i < 800; i += 1) {
      const out = play('bingo', 1000, {}, {}, `bingo|${i}`);
      const { card, called, lineCount, lines, ballCount, callCount } = out.outcome;
      assert.equal(card.length, 9);
      assert.equal(card[4], 0, 'the centre square is free');
      assert.equal(new Set(called).size, callCount, 'a ball is not called twice');
      assert.equal(ballCount, BINGO_BALLS);
      assert.ok(called.length <= BINGO_BALLS);
      assert.equal(lines.length, lineCount);
      if (lineCount === 0) {
        losses += 1;
        assert.equal(out.payout, 0);
        assert.equal(out.outcome.pattern, 'none');
      } else {
        wins += 1;
        assert.ok(out.payout > 0, 'a completed line must pay');
        assert.ok(lines.every((l) => l.cells.length === 3 && l.numbers.length === 3));
        for (const cell of lines.flatMap((l) => l.cells)) assert.ok(called.includes(card[cell]) || cell === 4);
      }
    }
    assert.ok(losses > 100, `${losses} losing rounds in 800 — the game cannot be unwinnable`);
    assert.ok(wins > 100, `${wins} winning rounds in 800 — the game must pay sometimes`);
    const { rtp, winRate } = measure('bingo', { iterations: 6000 });
    assert.ok(rtp > 0.85 && rtp < 1.01, `bingo returned ${(rtp * 100).toFixed(1)}%`);
    assert.ok(winRate > 0.1 && winRate < 0.6, `hit rate ${(winRate * 100).toFixed(1)}%`);
    for (const [count, pay] of Object.entries(BINGO_PAYTABLE)) {
      assert.ok(pay > 0, `${count} lines must pay something`);
      if (Number(count) > 1) assert.ok(pay > BINGO_PAYTABLE[Number(count) - 1], 'more lines must pay more');
    }
  });
});

describe('crash is a round, not a coin flip', () => {
  it('derives a bounded point with the advertised bust rate', () => {
    let instant = 0;
    let big = 0;
    const runs = 20000;
    for (let i = 0; i < runs; i += 1) {
      const p = crashPoint('server-seed', 'client-seed', i, 100);
      assert.ok(p >= CRASH_MIN && p <= CRASH_MAX, `point ${p} outside [${CRASH_MIN}, ${CRASH_MAX}]`);
      assert.equal(p, crashPoint('server-seed', 'client-seed', i, 100), 'the same round replays exactly');
      if (p === CRASH_MIN) instant += 1;
      if (p >= 10) big += 1;
    }
    const rate = instant / runs;
    assert.ok(rate > 0.005 && rate < 0.03, `instant busts were ${(rate * 100).toFixed(2)}% of rounds against a 1% edge`);
    assert.ok(big / runs > 0.02, 'a crash game without a tail is not crash');
    assert.notEqual(crashPoint('other-seed', 'client-seed', 1, 100), crashPoint('server-seed', 'client-seed', 1, 100));
    let instantBig = 0;
    for (let i = 0; i < 400; i += 1) if (crashPoint('s', 'c', i, 2000) === CRASH_MIN) instantBig += 1;
    assert.ok(instantBig > 40 && instantBig < 130, `a 20% edge busted ${instantBig}/400 rounds — the edge is a rate, not a certainty`);
    assert.ok(crashPoint('s', 'c', 1, 0) >= CRASH_MIN, 'a zero edge still cannot crash below 1x');
    assert.ok(crashPoint('s', 'c', 1, -50) >= CRASH_MIN, 'a nonsense edge cannot break the curve');
  });

  it('pays the multiplier the player accepted, and nothing after the bust', () => {
    assert.deepEqual(settleCrashBet({ stake: 1000, crashPoint: 5, cashedAt: 2 }), { status: 'cashout', payout: 2000, multiplier: 2 });
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 5, cashedAt: 5 }).status, 'cashout', 'cashing exactly on the bust point is a win');
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 5, cashedAt: 5.01 }).status, 'lost');
    // Cashing exactly on the bust multiplier is a win by the maths; the round
    // engine is what makes a 1.00x cashout impossible to submit (crash.cashout_invalid).
    assert.deepEqual(settleCrashBet({ stake: 1000, crashPoint: 1, cashedAt: 1 }), { status: 'cashout', payout: 1000, multiplier: 1 });
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 3, cashedAt: 0 }).status, 'lost');
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 3 }).status, 'lost');
    assert.equal(settleCrashBet({ stake: 999, crashPoint: 2.5, cashedAt: 1.37 }).payout, Math.floor(999 * 1.37), 'payouts round down, never up');
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 5, cashedAt: 2 }).reason, undefined);
    assert.equal(settleCrashBet({ stake: 1000, crashPoint: 5, cashedAt: 6 }).reason, 'crashed_before_cashout');
  });

  it('the animation curve and the settlement clock agree', () => {
    for (const t of [0, 1, 3.5, 12]) {
      const m = multiplierAt(t);
      assert.ok(m >= 1);
      assert.ok(Math.abs(timeForMultiplier(m) - t) < 0.35, `t=${t} → ${m}x → t'=${timeForMultiplier(m).toFixed(2)}s`);
    }
    assert.ok(multiplierAt(2) > multiplierAt(1), 'the plane only climbs');
    assert.equal(multiplierAt(0), 1, 'a round starts at 1.00x');
  });

  it('clamps an auto-cashout the client cannot win with', () => {
    assert.deepEqual(validateSelection(row('crash'), { autoCashout: 2 }), { autoCashout: 2 });
    assert.deepEqual(validateSelection(row('crash'), { autoCashout: 0.5 }), { autoCashout: null });
    assert.deepEqual(validateSelection(row('crash'), { autoCashout: 1e9 }), { autoCashout: 1000 });
    assert.deepEqual(validateSelection(row('crash'), {}), { autoCashout: null });
  });
});

describe('the engine registry is the only way in', () => {
  it('covers every engine the schema and admin panel can name', () => {
    for (const key of ['slots', 'roulette', 'dice', 'mines', 'wheel', 'plinko', 'bingo', 'blackjack', 'baccarat', 'three_patti', 'video_poker', 'crash']) {
      assert.ok(ENGINES[key], `${key} is missing from the registry`);
      assert.equal(typeof ENGINES[key].validate, 'function', `${key} must validate its selection`);
    }
    assert.deepEqual(ENGINE_KEYS, Object.keys(ENGINES));
    for (const key of ['mines', 'blackjack', 'video_poker']) {
      assert.equal(ENGINES[key].multiStep, true, `${key} needs a pending round`);
      assert.equal(typeof ENGINES[key].timeout, 'function', `${key} must resolve an abandoned hand`);
      assert.equal(isMultiStep({ engine: key }), true);
    }
    assert.equal(isMultiStep({ engine: 'slots' }), false);
    assert.equal(ENGINES.crash.run, undefined, 'crash is scheduled by the server, never played from the client');
    assert.throws(() => engineFor({ engine: 'pachinko' }), (e) => e.status === 500 && e.code === 'err.engine_missing');
    assert.throws(() => validateSelection({ engine: 'pachinko' }, {}, 100), (e) => e.code === 'err.engine_missing');
  });

  it('the deck is 52 cards per deck and ranks sort as expected', () => {
    const deck = buildDeck(new Rng('deck'), 1);
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck).size, 52, 'no duplicates in a single deck');
    assert.ok(deck.every((c) => /^[0-9JQKA]+[SHDC]$/.test(c)), 'wire format is rank+suit');
    assert.equal(rankOf('10H'), '10');
    assert.equal(suitOf('10H'), 'H');
    assert.equal(rankIdx('2S'), 0);
    assert.equal(rankIdx('AS'), 12);
    assert.equal(buildDeck(new Rng('deck'), 6).length, 312);
    const shuffled = buildDeck(new Rng('deck|shuffle'), 1);
    assert.notEqual(shuffled.join(','), buildDeck(new Rng('other'), 1).join(','), 'the shuffle must depend on the seed');
  });
});

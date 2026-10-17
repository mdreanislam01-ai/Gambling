import { HttpError } from '../lib/http.js';
import { cardGames, BACC_SIDES, PATTI_SIDES } from './cards.js';
import { tableGames, rouletteBetPayout, WHEEL_TARGETS, PLINKO_TABLES, MINES_CELLS } from './table.js';
import { reelGames } from './reels.js';
import { settleCrashBet, crashPoint } from './crash.js';

const { slots } = reelGames;
const { roulette, dice, mines, wheel, plinko, bingo } = tableGames;
const { blackjack, baccarat, videoPoker, threePatti } = cardGames;

const ROULETTE_TYPES = ['straight', 'split', 'street', 'corner', 'sixline', 'red', 'black', 'odd', 'even', 'low', 'high', 'dozen', 'column'];

const money = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
};

/**
 * Engine registry. Every game row in the DB points at one of these via
 * `games.engine`; the admin panel can only choose from this list.
 */
export const ENGINES = {
  slots: { run: slots.init.bind(slots), config: slots.config, validate: () => ({}) },
  roulette: {
    run: roulette.init.bind(roulette),
    validate(selection, stake) {
      const raw = Array.isArray(selection?.bets) ? selection.bets : [];
      if (!raw.length) throw new HttpError(400, 'err.bets_required');
      const bets = raw.map((b) => {
        const type = String(b?.type || '');
        if (!ROULETTE_TYPES.includes(type)) throw new HttpError(400, 'err.bet_type_invalid', { type });
        const numbers = Array.isArray(b.numbers) ? b.numbers.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).slice(0, 8) : [];
        const value = ['dozen', 'column'].includes(type) ? Math.round(Number(b.value)) : null;
        if (['dozen', 'column'].includes(value === null ? '' : type) && ![1, 2, 3].includes(value)) throw new HttpError(400, 'err.bet_value_invalid');
        if (['straight', 'split', 'street', 'corner', 'sixline'].includes(type) && !numbers.length) throw new HttpError(400, 'err.bet_numbers_required', { type });
        return { type, numbers, value, amount: money(b.amount) };
      }).filter((b) => b.amount > 0);
      const sum = bets.reduce((a, b) => a + b.amount, 0);
      if (sum !== stake) throw new HttpError(400, 'err.bets_stake_mismatch', { sum, stake });
      for (const b of bets) {
        const r = rouletteBetPayout(b.type, b.numbers, b.value, 0);
        if (r.error) throw new HttpError(400, r.error, { type: b.type });
      }
      return { bets };
    },
  },
  dice: {
    run: dice.init.bind(dice),
    validate(selection) {
      const mode = ['under', 'over', 'equal'].includes(selection?.mode) ? selection.mode : 'under';
      const target = Math.min(98, Math.max(2, Math.round(Number(selection?.target) || 50)));
      return { mode, target };
    },
  },
  mines: {
    run: mines.init.bind(mines),
    multiStep: true,
    actions: mines.act.bind(mines),
    timeout: mines.timeout,
    validate(selection) {
      const count = Math.min(24, Math.max(1, Math.round(Number(selection?.mines) || 3)));
      return { mines: count };
    },
  },
  wheel: {
    run: wheel.init.bind(wheel),
    validate(selection) {
      const target = WHEEL_TARGETS.includes(Number(selection?.target)) ? Number(selection?.target) : 2;
      return { target };
    },
  },
  plinko: {
    run: plinko.init.bind(plinko),
    validate(selection) {
      const risk = PLINKO_TABLES[selection?.risk] ? selection.risk : 'medium';
      return { risk };
    },
  },
  bingo: { run: bingo.init.bind(bingo), validate: () => ({}) },
  blackjack: {
    run: blackjack.init.bind(blackjack),
    multiStep: true,
    actions: blackjack.act.bind(blackjack),
    timeout: blackjack.timeout,
    validate: () => ({}),
  },
  baccarat: {
    run: baccarat.init.bind(baccarat),
    validate(selection, stake) {
      const raw = Array.isArray(selection?.bets) ? selection.bets : [];
      const bets = raw
        .map((b) => ({ side: BACC_SIDES.includes(b?.side) ? b.side : (() => { throw new HttpError(400, 'err.bet_side_invalid', { side: b?.side }); })(), amount: money(b.amount) }))
        .filter((b) => b.amount > 0);
      if (!bets.length) throw new HttpError(400, 'err.bets_required');
      const sum = bets.reduce((a, b) => a + b.amount, 0);
      if (sum !== stake) throw new HttpError(400, 'err.bets_stake_mismatch', { sum, stake });
      return { bets };
    },
  },
  three_patti: {
    run: threePatti.init.bind(threePatti),
    validate(selection, stake) {
      const raw = Array.isArray(selection?.bets) ? selection.bets : [];
      const bets = raw
        .map((b) => ({ side: PATTI_SIDES.includes(b?.side) ? b.side : (() => { throw new HttpError(400, 'err.bet_side_invalid', { side: b?.side }); })(), amount: money(b.amount) }))
        .filter((b) => b.amount > 0);
      if (!bets.length) throw new HttpError(400, 'err.bets_required');
      const sum = bets.reduce((a, b) => a + b.amount, 0);
      if (sum !== stake) throw new HttpError(400, 'err.bets_stake_mismatch', { sum, stake });
      return { bets };
    },
  },
  video_poker: {
    run: videoPoker.init.bind(videoPoker),
    multiStep: true,
    actions: videoPoker.act.bind(videoPoker),
    timeout: videoPoker.timeout,
    validate: () => ({}),
  },
  crash: {
    // Round-driven engine — settlement helpers only; the scheduler in
    // src/services/crash.js owns the round lifecycle.
    crashPoint,
    settle: settleCrashBet,
    validate(selection) {
      const raw = Number(selection?.autoCashout);
      const autoCashout = Number.isFinite(raw) && raw > 1 ? Math.min(1000, Math.max(1.01, raw)) : null;
      return { autoCashout };
    },
  },
};

export const ENGINE_KEYS = Object.keys(ENGINES);

export function engineFor(game) {
  const e = ENGINES[game?.engine];
  if (!e) throw new HttpError(500, 'err.engine_missing', { engine: game?.engine });
  return e;
}

export function isMultiStep(game) {
  return !!engineFor(game).multiStep;
}

export function validateSelection(game, selection, stake) {
  const e = engineFor(game);
  return e.validate ? e.validate(selection || {}, stake) : {};
}

/** One-shot games (slots/roulette/dice/…) resolve immediately. */
export function resolveInstant({ game, stake, selection, seedKey, nonce, clientSeed }) {
  const rng = new RngFactory(seedKey, clientSeed, nonce);
  const out = engineFor(game).run({
    stake,
    selection,
    game,
    rng: rng.instance(),
  });
  return out;
}

// Small indirection so engines keep receiving an `rng` object with int/pick/shuffle.
import { Rng } from './rng.js';
class RngFactory {
  constructor(seedKey, clientSeed, nonce) {
    this.seedKey = `${seedKey}|${nonce}|${clientSeed || 'default'}`;
  }
  instance() {
    return new Rng(this.seedKey);
  }
}

export { Rng };

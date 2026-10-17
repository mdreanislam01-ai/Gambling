import crypto from 'node:crypto';
import { Rng } from '../games/rng.js';
import { get, run, all, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import config from '../config.js';
import { json } from '../lib/util.js';
import { engineFor, validateSelection, isMultiStep } from '../games/index.js';
import * as catalog from './catalog.js';
import * as wallet from './wallet.js';
import { nextNonce } from './fairness.js';
import { notifyUser } from './notify.js';
import { broadcast } from './events.js';
import { betsEnabled, isMaintenance } from './settings.js';

const newPublicId = () => `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`.slice(0, 18);

export function publicBet(row, { includeState = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.public_id,
    kind: row.kind,
    gameKey: row.game_key,
    gameName: row.game_name || null,
    stake: row.stake,
    payout: row.payout,
    profit: row.payout - row.stake,
    status: row.status,
    multiplier: row.multiplier,
    currency: row.currency,
    createdAt: row.created_at,
    settledAt: row.settled_at,
    selection: json(row.selection, {}),
    outcome: json(row.outcome, {}),
    view: json(row.view, null),
    roundId: row.round_id ?? null,
    fair: row.server_seed_hash ? { hash: row.server_seed_hash, nonce: row.nonce, clientSeed: row.client_seed, verifiable: true } : null,
  };
  if (includeState) out.state = json(row.state, null);
  return out;
}

export function assertBetable(user, game, stake) {
  if (isMaintenance() && config.isProd) throw new HttpError(503, 'err.maintenance');
  if (!betsEnabled()) throw new HttpError(503, 'err.bets_disabled');
  if (!user) throw new HttpError(401, 'auth.required');
  if (user.status !== 'active') throw new HttpError(403, 'acc.suspended');
  if (user.self_exclusion_until && new Date(String(user.self_exclusion_until).replace(' ', 'T') + 'Z') > new Date()) {
    throw new HttpError(403, 'rg.self_excluded', { until: user.self_exclusion_until });
  }
  if (!game || game.visibility === 'hidden' || !game.enabled) throw new HttpError(404, 'err.game_unavailable');
  const s = Math.round(Number(stake));
  if (!Number.isFinite(s) || s <= 0) throw new HttpError(400, 'err.stake_invalid');
  if (s < game.minBet) throw new HttpError(400, 'err.stake_below_min', { min: game.minBet });
  if (s > game.maxBet) throw new HttpError(400, 'err.stake_above_max', { max: game.maxBet });
  const w = wallet.walletOf(user.id);
  if (!w || w.balance < s) throw new HttpError(400, 'err.insufficient_balance', { need: s, have: w?.balance ?? 0 });
  const dailyLimit = Number(user.daily_loss_limit ?? 0);
  if (dailyLimit > 0) {
    const loss = wallet.netLossToday(user.id);
    if (loss + s > dailyLimit) throw new HttpError(403, 'rg.daily_loss_limit', { limit: dailyLimit, loss });
  }
  const weekly = Number(user.weekly_wager_limit ?? 0);
  if (weekly > 0 && wallet.wageredThisWeek(user.id) + s > weekly) throw new HttpError(403, 'rg.weekly_wager_limit', { limit: weekly });
  return { stake: s };
}

export function openBetRow({ userId, kind, gameKey, stake, selection, roundId = null, autoCashout = null, fixtureId = null, fair = null, state = null, view = null, status = 'pending' }) {
  const publicId = newPublicId();
  run(
    `INSERT INTO bets(public_id, user_id, kind, game_key, fixture_id, stake, selection, status, round_id, auto_cashout, state, view, server_seed_hash, nonce, client_seed, fair, seed_id)
     VALUES(:p,:u,:kind,:g,:f,:stake,:sel,:status,:roundId,:ac,:state,:view,:hash,:nonce,:cs,1,:seedId)`,
    {
      p: publicId, u: userId, kind, g: gameKey, f: fixtureId, stake: Math.round(stake),
      sel: JSON.stringify(selection ?? {}), status, roundId,
      ac: autoCashout ?? null,
      state: state ? JSON.stringify(state) : null,
      view: view ? JSON.stringify(view) : null,
      hash: fair?.serverSeedHash ?? null, nonce: fair?.nonce ?? null, cs: fair?.clientSeed ?? null,
      seedId: fair?.seedId ?? null,
    }
  );
  return get(`SELECT b.*, g.name AS game_name FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.public_id = :p`, { p: publicId });
}

/** Credit winnings + close the bet. Must run inside an open transaction. */
export function settleBetTx({ betId, status, payout, outcome = null, view = null, multiplier = null, state = null }) {
  const bet = get(`SELECT * FROM bets WHERE id = :id`, { id: betId });
  if (!bet) throw new HttpError(404, 'err.bet_not_found');
  if (bet.status !== 'pending') return bet;
  const pay = Math.max(0, Math.round(Number(payout) || 0));
  run(
    `UPDATE bets SET status = :status, payout = :payout, outcome = :outcome, view = :view, multiplier = :mult,
            state = :state, settled_at = datetime('now') WHERE id = :id`,
    {
      id: betId, status, payout: pay,
      outcome: outcome === null ? bet.outcome : JSON.stringify(outcome),
      view: view === undefined ? bet.view : view === null ? null : JSON.stringify(view),
      mult: multiplier ?? (bet.stake ? pay / bet.stake : 0),
      state: state === undefined ? bet.state : state === null ? null : JSON.stringify(state),
    }
  );
  if (pay > 0) wallet.credit({ userId: bet.user_id, amount: pay, kind: 'payout', reference: bet.public_id, noteKey: 'wallet.note.payout' });
  recordDay({ wagered: 0, paid: pay, won: status === 'won' || status === 'cashout' ? 1 : 0, count: 0 });
  return get(`SELECT b.*, g.name AS game_name FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.id = :id`, { id: betId });
}

export function recordDay({ wagered = 0, paid = 0, won = 0, count = 1 }) {
  const day = new Date().toISOString().slice(0, 10);
  run(
    `INSERT INTO daily_stats(day, bets, wagered, paid, wins) VALUES(:d,:c,:w,:p,:won)
     ON CONFLICT(day) DO UPDATE SET bets = bets + :c, wagered = wagered + :w, paid = paid + :p, wins = wins + :won`,
    { d: day, c: count, w: wagered, p: paid, won }
  );
}

function maybeNotifyBigWin(user, bet) {
  const mult = bet.stake ? bet.payout / bet.stake : 0;
  if (bet.status === 'pending') return;
  if (mult >= 20 && bet.payout > bet.stake) {
    notifyUser(user.id, {
      titleKey: 'notif.big_win', bodyKey: 'notif.big_win_body',
      params: { multiplier: Math.round(mult * 100) / 100, amount: bet.payout, game: bet.game_name || bet.game_key },
      level: 'success', icon: 'trophy', link: `/account/history?bet=${bet.public_id}`,
    });
  }
}

/**
 * Place a casino bet. Instant engines settle in the same transaction;
 * multi-step engines (blackjack, video poker, mines) stay pending and their
 * state is persisted on the bet row so it survives refreshes and restarts.
 */
export function placeCasinoBet({ user, gameKey, stake, selection, clientSeed }) {
  const game = catalog.getGame(gameKey);
  const s = Math.round(Number(stake));
  assertBetable(user, game, s);
  if (game.engine === 'crash') {
    // Round-based: delegated to the crash engine (dynamic import avoids a cycle).
    return import('./crash.js').then((m) => m.crashEngine.join({ user, game, stake: s, selection: validateSelection(game, selection, s) }));
  }
  const validated = validateSelection(game, selection, s);
  return tx(() => {
    const fair = nextNonce(user.id);
    if (clientSeed !== undefined && clientSeed !== null) {
      run(`UPDATE fairness_seeds SET client_seed = :c WHERE id = :id`, { c: String(clientSeed).slice(0, 48) || 'player', id: fair.seedId });
    }
    wallet.debit({ userId: user.id, amount: s, reference: null, noteKey: 'wallet.note.stake' });
    const engine = engineFor(game);
    const out = engine.run({ stake: s, selection: validated, game, rng: rngFrom(fair) });
    if (out.error) throw new HttpError(400, out.error);
    const multiStep = !!engine.multiStep;
    const resolved = multiStep && out.status === 'pending' ? null : out;
    const state = multiStep && resolved === null ? out.state ?? null : out.state ?? null;
    const view = out.view ?? null;
    const row = openBetRow({
      userId: user.id, kind: 'casino', gameKey, stake: s,
      selection: { ...validated, ...(resolved?.outcome ? {} : {}) },
      fair: { ...fair, clientSeed: clientSeed ?? fair.clientSeed },
      state, view,
    });
    recordDay({ wagered: s, paid: 0, count: 0 });
    catalog.bumpPlays(gameKey);
    if (resolved) {
      const status = resolved.payout <= s && resolved.status !== 'lost' ? (resolved.payout === s ? 'void' : 'lost') : resolved.status;
      const bet = settleBetTx({
        betId: row.id, status, payout: resolved.payout, outcome: resolved.outcome, view: resolved.view ?? null,
        multiplier: resolved.multiplier ?? (s ? resolved.payout / s : 0),
      });
      maybeNotifyBigWin(user, bet);
      broadcast('bet:settled', betView(bet));
      return { bet: publicBet(bet), view: json(bet.view), outcome: json(bet.outcome), pending: false, fair };
    }
    run(`UPDATE bets SET state = :st, view = :v WHERE id = :id`, { id: row.id, st: JSON.stringify(state), v: JSON.stringify(view) });
    broadcast('bet:opened', { id: row.public_id, gameKey, stake: s });
    return { bet: publicBet(row), view, actions: view?.actions ?? [], pending: true, fair };
  });
}

const rngFrom = (fair) => new Rng(`${fair.serverSeed}|${fair.nonce}|${fair.clientSeed || 'player'}`);

export async function actOnBet({ user, betId, action, selection }) {
  const row = get(`SELECT b.*, g.name AS game_name, g.engine, g.config FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.public_id = :p`, { p: betId });
  if (!row) throw new HttpError(404, 'err.bet_not_found');
  if (row.user_id !== user.id) throw new HttpError(403, 'err.forbidden');
  if (row.status !== 'pending') throw new HttpError(409, 'err.round_closed');
  const game = { engine: row.engine, config: json(row.config, {}), house_edge_bps: 100, ...catalog.getGame(row.game_key, { includeDisabled: true }) };
  const engine = engineFor({ ...game, engine: row.engine });
  if (!engine.actions) throw new HttpError(400, 'err.action_not_allowed');
  const state = json(row.state, null);
  if (!state) throw new HttpError(409, 'err.state_missing');
  return tx(() => {
    const out = engine.actions({ state, action, selection: selection || {}, stake: row.stake, bet: row, game });
    if (out.error) throw new HttpError(400, out.error);
    if (out.status === 'pending') {
      run(`UPDATE bets SET state = :s, view = :v WHERE id = :id`, { id: row.id, s: JSON.stringify(out.state), v: JSON.stringify(out.view ?? null) });
      const fresh = get(`SELECT b.*, g.name AS game_name FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.id = :id`, { id: row.id });
      return { bet: publicBet(fresh), view: out.view, actions: out.actions, pending: true };
    }
    const bet = settleBetTx({
      betId: row.id, status: out.status, payout: out.payout, outcome: out.outcome ?? null, view: out.view ?? null,
      multiplier: out.multiplier ?? (row.stake ? out.payout / row.stake : 0), state: out.state ?? null,
    });
    maybeNotifyBigWin(user, bet);
    broadcast('bet:settled', betView(bet));
    return { bet: publicBet(bet), view: out.view ?? null, pending: false };
  });
}

const betView = (bet) => ({ publicId: bet.public_id, gameKey: bet.game_key, status: bet.status, stake: bet.stake, payout: bet.payout, userId: bet.user_id });

export function listUserBets(userId, { limit = 25, offset = 0, gameKey = null, status = null, kind = null } = {}) {
  const p = { u: userId, limit: Math.min(200, Math.max(1, limit)), offset: Math.max(0, offset) };
  const where = ['b.user_id = :u'];
  if (gameKey) { where.push('b.game_key = :gameKey'); p.gameKey = gameKey; }
  if (status) { where.push('b.status = :status'); p.status = status; }
  if (kind) { where.push('b.kind = :kind'); p.kind = kind; }
  const rows = all(
    `SELECT b.*, g.name AS game_name FROM bets b LEFT JOIN games g ON g.key = b.game_key
     WHERE ${where.join(' AND ')} ORDER BY b.id DESC LIMIT :limit OFFSET :offset`, p
  );
  const total = get(`SELECT COUNT(*) c FROM bets b WHERE ${where.join(' AND ')}`, p)?.c ?? 0;
  return { rows: rows.map((r) => publicBet(r)), total };
}

export function getActiveHand(userId, gameKey) {
  const row = get(
    `SELECT b.*, g.name AS game_name, g.engine FROM bets b LEFT JOIN games g ON g.key = b.game_key
     WHERE b.user_id = :u AND b.status = 'pending' AND b.kind = 'casino' ${gameKey ? 'AND b.game_key = :g' : ''} ORDER BY b.id DESC LIMIT 1`,
    { u: userId, g: gameKey }
  );
  if (!row) return null;
  const engine = engineFor({ engine: row.engine });
  const view = json(row.view, {});
  return { ...publicBet(row, { includeState: true }), engine: row.engine, view, actions: view?.actions ?? [] };
}

export function abandonHand(userId, betId) {
  return tx(() => {
    const row = get(`SELECT b.*, g.engine FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.public_id = :p AND b.user_id = :u`, { p: betId, u: userId });
    if (!row) throw new HttpError(404, 'err.bet_not_found');
    if (row.status !== 'pending') throw new HttpError(409, 'err.round_closed');
    const engine = engineFor({ engine: row.engine });
    if (engine.timeout && row.state) {
      const out = engine.timeout(json(row.state, {}));
      if (out && out.payout !== undefined && out.status !== 'lost') return settleBetTx({ betId: row.id, status: out.status, payout: out.payout, outcome: out.outcome, state: out.state });
    }
    // No forced result: refund the stake and void the round.
    wallet.credit({ userId, amount: row.stake, kind: 'refund', reference: row.public_id, noteKey: 'wallet.note.refund' });
    return settleBetTx({ betId: row.id, status: 'void', payout: row.stake, outcome: { abandoned: true }, state: null });
  });
}

/** Restart / timeout recovery for durable multi-step games. */
export function recoverPendingCasinoBets({ olderThanMinutes = 30 } = {}) {
  const rows = all(
    `SELECT b.*, g.engine, g.config FROM bets b JOIN games g ON g.key = b.game_key
     WHERE b.status = 'pending' AND b.kind = 'casino' AND b.created_at <= datetime('now', :m)`,
    { m: `-9999 minutes` }
  ).filter((r) => Date.parse(String(r.created_at).replace(' ', 'T') + 'Z') < Date.now() - olderThanMinutes * 60000 || olderThanMinutes === 0);
  let handled = 0;
  for (const row of rows) {
    try {
      tx(() => {
        const engine = engineFor({ engine: row.engine });
        const state = json(row.state, null);
        if (state && engine.timeout) {
          const out = engine.timeout(state);
          settleBetTx({ betId: row.id, status: out.status, payout: out.payout ?? 0, outcome: { ...out.outcome, auto_settled: true }, state: out.state ?? null, multiplier: out.multiplier ?? 0 });
        } else {
          wallet.credit({ userId: row.user_id, amount: row.stake, kind: 'refund', reference: row.public_id, noteKey: 'wallet.note.refund' });
          settleBetTx({ betId: row.id, status: 'void', payout: row.stake, outcome: { auto_settled: true, refunded: true }, state: null });
        }
        notifyUser(row.user_id, { titleKey: 'notif.hand_auto_settled', bodyKey: 'notif.hand_auto_settled_body', params: { game: row.game_key }, level: 'info', link: '/account/history' });
      });
      handled += 1;
    } catch (err) {
      import('./audit.js').then((m) => m.logError({ code: 'bets.recover_failed', message: err.message, meta: { betId: row.id } }));
    }
  }
  return handled;
}

export const stats = {
  userGameStats(userId) {
    const row = get(
      `SELECT COUNT(*) bets, COALESCE(SUM(stake),0) wagered, COALESCE(SUM(payout),0) paid,
              SUM(CASE WHEN status IN ('won','cashout') THEN 1 ELSE 0 END) wins,
              MAX(multiplier) best_multiplier
       FROM bets WHERE user_id = :u`, { u: userId }
    );
    return {
      bets: row?.bets ?? 0,
      wagered: row?.wagered ?? 0,
      paid: row?.paid ?? 0,
      net: (row?.paid ?? 0) - (row?.wagered ?? 0),
      wins: row?.wins ?? 0,
      bestMultiplier: row?.best_multiplier ?? 0,
    };
  },
};

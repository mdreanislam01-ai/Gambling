import { HttpError } from '../lib/http.js';
import config from '../config.js';
import { get, all, run } from '../db/index.js';
import { clamp, toCents } from '../lib/util.js';
import * as catalog from '../services/catalog.js';
import { listUserBets, placeCasinoBet, actOnBet, getActiveHand, abandonHand, stats as betStats } from '../services/bets.js';
import { walletSummary, transactions, dailyResetBonus, dailyBonusEnabled, netLossToday, transactionCount, dailyBonusStatus } from '../services/wallet.js';
import { seedView, historySeeds, setClientSeed, rotateSeed, verifyBet } from '../services/fairness.js';
import { crashEngine, crashPublicState, roundHistory } from '../services/crash.js';
import { liveEngine } from '../services/live.js';
import { readStake } from './auth.js';
import { ENGINES } from '../games/index.js';
import { BACC_SIDES, BACCARAT_PAYS, PATTI_SIDES, PATTI_PAYS } from '../games/cards.js';
import { PLINKO_ROWS, PLINKO_TABLES, MINES_CELLS, WHEEL_TARGETS, WHEEL_SEGMENTS, BINGO_LINES, BINGO_BALLS, BINGO_CALLS } from '../games/table.js';

/**
 * The play screen draws its own paytable, so the row has to carry the numbers the
 * engine will actually pay — for slots the prize scale is derived by the engine
 * from the configured RTP, and it is not stored on the catalogue row.
 */
function engineDisplayConfig(game) {
  const cfg = { ...(game.config || {}) };
  if (game.engine === 'slots' && ENGINES.slots.config) {
    const calibrated = ENGINES.slots.config(game);
    cfg.reels = calibrated.reels;
    cfg.rows = calibrated.rows;
    cfg.lines = calibrated.lines;
    cfg.symbols = calibrated.symbols;
    cfg.freeSpins = calibrated.freeSpins ?? null;
    cfg.payScale = calibrated.payScale;
  }
  // Everything else the play screen prints a number for is served from the engine
  // too, so a label can never disagree with what is paid.
  if (game.engine === 'baccarat') {
    cfg.sides = BACC_SIDES;
    cfg.odds = BACCARAT_PAYS;
  }
  if (game.engine === 'three_patti') {
    cfg.sides = PATTI_SIDES;
    cfg.odds = PATTI_PAYS;
  }
  if (game.engine === 'plinko') {
    cfg.rows = PLINKO_ROWS;
    cfg.tables = PLINKO_TABLES;
  }
  if (game.engine === 'wheel') {
    cfg.segments = WHEEL_SEGMENTS;
    cfg.options = WHEEL_TARGETS;
  }
  if (game.engine === 'mines') {
    cfg.cells = MINES_CELLS;
  }
  if (game.engine === 'bingo') {
    cfg.lines = BINGO_LINES.length;
    cfg.balls = BINGO_BALLS;
    cfg.calls = BINGO_CALLS;
  }
  return cfg;
}

const requireUser = (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'auth.required');
  return ctx.rawUser ?? { id: ctx.user.id, ...ctx.user };
};

export function registerGameRoutes(route) {
  // The lobby page: search, category, sort and favourites, with the counts behind the filter chips.
  route('GET', '/api/games', (ctx) => {
    const q = ctx.query;
    const rows = catalog.listGames({
      category: q.category || null,
      search: q.q || q.search || null,
      sort: q.sort || 'curated',
      userId: ctx.user?.id ?? null,
      limit: clamp(Number(q.limit) || 60, 1, 120),
      offset: Math.max(0, Number(q.offset) || 0),
    });
    const filters = { category: q.category || null, search: q.q || q.search || null, userId: ctx.user?.id ?? null };
    return { rows, total: catalog.countGames(filters), categories: catalog.categoriesWithCounts() };
  });

  // Category names with how many enabled games each holds, for the lobby rail.
  route('GET', '/api/games/categories', () => ({ rows: catalog.categoriesWithCounts() }));

  // One game, with the config the play screen draws numbers from and any hand still open.
  route('GET', '/api/games/:key', (ctx) => {
    // includeConfig: the play screen shows the paytable, so the row must carry
    // the symbols and weights that the engine actually spins.
    const game = catalog.getGame(ctx.params.key, { includeConfig: true }) ||
      (ctx.user?.role === 'admin' ? catalog.updateGame(ctx.params.key, {}) : null);
    if (!game) throw new HttpError(404, 'err.game_not_found');
    if (game) game.config = engineDisplayConfig(game);
    const live = all(`SELECT status FROM bets WHERE user_id = :u AND game_key = :k AND status = 'pending'`, { u: ctx.user?.id ?? 0, k: ctx.params.key });
    return {
      game,
      favorites: ctx.user ? catalog.favoriteKeys(ctx.user.id) : [],
      hasPendingHand: live.length > 0,
      recentWins: all(
        `SELECT b.public_id, b.stake, b.payout, b.multiplier, b.created_at FROM bets b
         WHERE b.game_key = :k AND b.status IN ('won','cashout') ORDER BY b.id DESC LIMIT 8`, { k: ctx.params.key }
      ),
    };
  });

  // Place a casino bet: stake, limits and responsible-gaming checks first, then one engine round.
  route('POST', '/api/games/:key/bet', { auth: true, limit: 'bet' }, async (ctx) => {
    const user = requireUser(ctx);
    const stake = readStake(ctx.body);
    const out = await placeCasinoBet({
      user,
      gameKey: ctx.params.key,
      stake,
      selection: ctx.body?.selection ?? {},
      clientSeed: ctx.body?.clientSeed,
    });
    return { ...out, wallet: walletSummary(user.id), demo: true };
  });

  // Bets waiting on the player, so a reload can pick a hand back up.
  route('GET', '/api/bets/active', { auth: true }, (ctx) => ({
    hand: getActiveHand(ctx.user.id, ctx.query.gameKey || null),
  }));

  // Act on an open hand: hit, stand, double, split, pick a tile, cash out, or draw.
  route('POST', '/api/bets/:id/action', { auth: true, limit: 'bet' }, async (ctx) => {
    const user = requireUser(ctx);
    const out = await actOnBet({ user, betId: ctx.params.id, action: String(ctx.body?.action || ''), selection: ctx.body?.selection ?? {} });
    return { ...out, wallet: walletSummary(user.id) };
  });

  // Close an open hand and refund the stake, for the case where the player walks away.
  route('POST', '/api/bets/:id/abandon', { auth: true }, (ctx) => {
    const bet = abandonHand(ctx.user.id, ctx.params.id);
    return { ok: true, bet, wallet: walletSummary(ctx.user.id) };
  });

  // Bet history with the filters the history page exposes.
  route('GET', '/api/bets', { auth: true }, (ctx) => {
    const { rows, total } = listUserBets(ctx.user.id, {
      limit: clamp(Number(ctx.query.limit) || 25, 1, 100),
      offset: Math.max(0, Number(ctx.query.offset) || 0),
      gameKey: ctx.query.gameKey || null,
      status: ctx.query.status || null,
      kind: ctx.query.kind || null,
    });
    return { rows, total, stats: betStats.userGameStats(ctx.user.id), games: catalog.listGames({ limit: 200 }).map((g) => ({ key: g.key, name: g.name, nameKey: g.nameKey })) };
  });

  // Balance, the pending daily bonus and the last ledger rows.
  route('GET', '/api/wallet', { auth: true }, (ctx) => ({
    ...walletSummary(ctx.user.id),
    transactions: transactions(ctx.user.id, {
      limit: clamp(Number(ctx.query.limit) || 25, 1, 100),
      offset: Math.max(0, Number(ctx.query.offset) || 0),
      kind: ctx.query.kind || null,
    }),
    transactionCount: transactionCount(ctx.user.id),
    todayLoss: netLossToday(ctx.user.id),
    limits: {
      dailyLoss: ctx.user.limits.dailyLoss,
      weeklyWager: ctx.user.limits.weeklyWager,
      sessionMinutes: ctx.user.limits.sessionMinutes,
    },
    demoNotice: { titleKey: 'rg.demo_notice', currency: config.demo.currency, unitLabel: 'demo_credit' },
    dailyBonus: dailyBonusStatus(ctx.user.id),
  }));

  // Claim today's demo bonus once per day; the refusal says when the next one is.
  route('POST', '/api/wallet/claim-daily', { auth: true, limit: 'write' }, (ctx) => {
    const amount = dailyResetBonus(ctx.user.id);
    if (!amount) throw new HttpError(409, dailyBonusEnabled() ? 'wallet.daily_already' : 'wallet.daily_disabled');
    return { amount, wallet: walletSummary(ctx.user.id) };
  });

  // The saved game keys for this account.
  route('GET', '/api/favorites', { auth: true }, (ctx) => ({ keys: catalog.favoriteKeys(ctx.user.id) }));

  // Add or remove a game from the favourites list.
  route('POST', '/api/favorites/:gameKey', { auth: true, limit: 'write' }, (ctx) => ({
    ...catalog.setFavorite(ctx.user.id, ctx.params.gameKey, ctx.body?.on !== false),
    keys: catalog.favoriteKeys(ctx.user.id),
  }));

  // The committed seed hash, the client seed, the nonce counter and the revealed history.
  route('GET', '/api/fairness', { auth: true }, (ctx) => ({
    current: seedView(ctx.user.id),
    revealed: historySeeds(ctx.user.id, 20),
    explanationKey: 'fairness.explain',
    engine: 'HMAC-SHA256(server_seed, "game:nonce:client_seed")',
  }));

  // Set the client seed used for every bet from now on. Long values are truncated, not rejected.
  route('POST', '/api/fairness/client-seed', { auth: true, limit: 'write' }, (ctx) => ({
    ...setClientSeed(ctx.user.id, ctx.body?.clientSeed),
    current: seedView(ctx.user.id),
  }));

  // Reveal the current seed and open a new one, which makes past bets verifiable.
  route('POST', '/api/fairness/rotate', { auth: true, limit: 'write' }, (ctx) => rotateSeed(ctx.user.id));

  // Recompute a settled bet from the published seed and compare every field, not only the payout.
  route('GET', '/api/fairness/verify/:betId', (ctx) => verifyBet(ctx.params.betId));

  // The live crash round: phase, multiplier, bust point once known, and recent rounds.
  route('GET', '/api/crash', (ctx) => ({
    state: crashPublicState(ctx.user),
    history: roundHistory(24),
    growth: crashEngine.growth,
  }));

  // Bank an open crash bet at the multiplier it reached; after the bust this is refused.
  route('POST', '/api/crash/cashout', { auth: true, limit: 'bet' }, (ctx) => {
    const user = requireUser(ctx);
    const out = crashEngine.cashout(user, String(ctx.body?.bet || ''), Number(ctx.body?.multiplier) || 0);
    return { ...out, wallet: walletSummary(user.id), state: crashPublicState(user) };
  });

  // The studio tables: status, dealer, countdown and the last results per table.
  route('GET', '/api/live/tables', (ctx) => ({
    rows: catalog.listLiveTables().map((t) => ({ ...t, live: liveEngine.stateFor(t.key, ctx.user?.id ?? null) })),
    simulated: true,
  }));

  // One live table with its seats, its open round and the player's own bets on it.
  route('GET', '/api/live/:key', (ctx) => {
    const state = liveEngine.stateFor(ctx.params.key, ctx.user?.id ?? null);
    if (!state) throw new HttpError(404, 'live.table_not_found');
    return { table: catalog.listLiveTables().find((t) => t.key === ctx.params.key) || null, ...state };
  });

  // Bet into an open live round. Once the countdown reaches zero the seat is closed.
  route('POST', '/api/live/:key/bet', { auth: true, limit: 'bet' }, (ctx) => {
    const user = requireUser(ctx);
    const stake = readStake(ctx.body);
    const out = liveEngine.join({ user, tableKey: ctx.params.key, stake, selection: ctx.body?.selection ?? {} });
    return { ...out, wallet: walletSummary(user.id), state: liveEngine.stateFor(ctx.params.key, user.id) };
  });

  // Round ledger for a round-based game, each entry verifiable against its own seed.
  route('GET', '/api/rounds/:gameKey', (ctx) => ({
    rows: all(`SELECT id, status, result, server_seed_hash, server_seed, started_at, ended_at FROM game_rounds
               WHERE game_key = :g ORDER BY id DESC LIMIT 30`, { g: ctx.params.gameKey })
      .map((r) => ({ ...r, result: JSON.parse(r.result || 'null') })),
  }));
}

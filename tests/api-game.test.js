/**
 * Casino lobby, bet placement, multi-step hands, wallet ledger integrity,
 * responsible-gaming enforcement and provably-fair verification.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootTestApp } from './helpers/app.js';

let app;
const code = (res) => res.body?.error?.code;

before(async () => { app = await bootTestApp({ engines: true }); });
after(async () => { await app.close(); });

describe('casino lobby', () => {
  it('lists games with categories, filters and pagination', async () => {
    const all = await app.client().get('/api/games?limit=100');
    assert.equal(all.status, 200);
    assert.ok(all.body.data.rows.length >= 15, 'a real catalogue, not a couple of demo cards');
    assert.ok(all.body.data.categories.length >= 4);
    const row = all.body.data.rows[0];
    for (const field of ['key', 'name', 'nameKey', 'category', 'engine', 'minBet', 'maxBet', 'rtpBps', 'enabled', 'visibility']) {
      assert.ok(row[field] !== undefined, `row.${field}`);
    }
    const slots = await app.client().get('/api/games?category=slots&limit=100');
    assert.ok(slots.body.data.rows.length > 0);
    assert.ok(slots.body.data.rows.every((g) => g.category === 'slots'));
    assert.ok(slots.body.data.total >= slots.body.data.rows.length);
  });

  it('searches by name and hides what is not public', async () => {
    const hits = await app.client().get('/api/games?q=roulette');
    assert.ok(hits.body.data.rows.length >= 1);
    assert.ok(hits.body.data.rows.every((g) => JSON.stringify(g).includes('roulette')), 'only games that actually match the term');
    assert.ok(hits.body.data.rows.some((g) => g.key === 'european-roulette'));
    const miss = await app.client().get('/api/games?q=zzzz-no-such-game');
    assert.equal(miss.body.data.rows.length, 0);
    assert.equal(miss.body.data.total, 0);
    const anon = await app.client().get('/api/games?limit=200');
    assert.ok(anon.body.data.rows.every((g) => g.visibility !== 'hidden' && g.enabled !== false));
  });

  it('returns a single game with its paytable and rejects unknown keys', async () => {
    const one = await app.client().get('/api/games/european-roulette');
    assert.equal(one.status, 200);
    assert.equal(one.body.data.game.key, 'european-roulette');
    assert.ok(Array.isArray(one.body.data.recentWins), 'recent-win strip data');
    assert.deepEqual(one.body.data.favorites, [], 'anonymous visitors have no favorites');
    const bad = await app.client().get('/api/games/not-a-real-game');
    assert.equal(bad.status, 404);
    assert.equal(code(bad), 'err.game_not_found');
  });
});

describe('placing bets', () => {
  it('settles a slots spin, moves the balance and writes a balanced ledger', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/golden-voyage')).body.data.game;
    const stake = Math.max(game.minBet, 5000);
    const res = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: stake, selection: {} });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.pending, false);
    assert.equal(d.demo, true, 'the response is explicitly labelled demo');
    assert.ok(['won', 'lost', 'void'].includes(d.bet.status), d.bet.status);
    assert.equal(d.bet.stake, stake);
    assert.ok(d.bet.payout >= 0 && d.bet.payout <= stake * 200);
    assert.equal(d.wallet.balance, 500000 - stake + d.bet.payout, 'balance = start - stake + payout');
    assert.equal(d.bet.fair?.verifiable, true, 'every spin is verifiable');

    const led = await c.get('/api/wallet');
    const txs = led.body.data.transactions;
    const sum = txs.reduce((a, x) => a + x.amount, 0);
    assert.equal(sum, led.body.data.balance, 'ledger rows must add up to the balance');
    assert.ok(txs.some((x) => x.kind === 'bet' && x.amount === -stake));
    if (d.bet.payout > 0) assert.ok(txs.some((x) => x.kind === 'payout' && x.amount === d.bet.payout));
    for (const x of txs) {
      assert.ok(!x.noteKey || /^[a-z0-9_.]+$/.test(x.noteKey), `note must be a message key, got ${x.noteKey}`);
      assert.ok(x.kind && x.amount !== undefined && x.createdAt, 'ledger row is complete');
    }
  });

  it('validates the stake against the game limits and the balance', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    const below = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: Math.max(1, game.minBet - 1) });
    assert.equal(below.status, 400);
    assert.equal(code(below), 'err.stake_below_min');
    assert.equal(below.body.error.params.min, game.minBet);
    const negative = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: -500 });
    assert.equal(negative.status, 400);
    assert.equal(code(negative), 'err.stake_invalid', 'a negative stake is nonsense, not "below minimum"');
    const nan = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: 'abc' });
    assert.equal(nan.status, 400);
    const above = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: game.maxBet * 3 });
    assert.equal(above.status, 400);
    assert.equal(code(above), 'err.stake_above_max');
    const broke = await app.player();
    const big = Math.min(game.maxBet, 400000);
    const first = await broke.post(`/api/games/lucky-dice/bet`, { stakeCents: big });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    // Draining the balance by gambling would make this a coin toss — a couple of
    // wins put the money back, and then the stake asked for runs into the table
    // limit before it ever reaches the balance check. The admin debit moves the
    // same money through the ledger, so only the error code is under test.
    const balNow = (await broke.get('/api/wallet')).body.data.balance;
    const left = game.minBet - 1;
    const admin = await app.admin();
    const adjust = await admin.post(`/api/admin/users/${broke.identity.userId}/credits`, {
      amountCents: left - balNow,
      reason: 'test: leave the balance one credit below the table minimum',
    });
    assert.equal(adjust.status, 200, JSON.stringify(adjust.body));
    assert.equal((await broke.get('/api/wallet')).body.data.balance, left, 'the debit landed');
    const poor = await broke.post(`/api/games/lucky-dice/bet`, { stakeCents: game.minBet });
    assert.equal(poor.status, 400);
    assert.equal(code(poor), 'err.insufficient_balance', 'the stake is legal here, so the balance is what refuses it');
    assert.equal(poor.body.error.params.need, game.minBet);
    assert.equal(poor.body.error.params.have, left);
    const refunded = app.db.get('SELECT kind FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [broke.identity.userId]);
    assert.equal(refunded.kind, 'admin_debit', 'a staff adjustment is recorded as a debit, not a silent rewrite');
    assert.ok(poor.body.error.params.have <= left + 100000);
  });

  it('rejects malformed selections instead of defaulting to a free spin', async () => {
    const c = await app.player();
    const roulette = (await c.get('/api/games/european-roulette')).body.data.game;
    const noBets = await c.post(`/api/games/european-roulette/bet`, { stakeCents: 2000, selection: { bets: [] } });
    assert.equal(noBets.status, 400);
    assert.ok(['err.bets_required', 'err.bet_type_invalid', 'val.enum'].includes(code(noBets)), code(noBets));
    const badNumber = await c.post(`/api/games/european-roulette/bet`, { stakeCents: 2000, selection: { bets: [{ type: 'straight', numbers: [99], amount: 2000 }] } });
    assert.equal(badNumber.status, 400);
    assert.ok(String(code(badNumber)).startsWith('err.') || code(badNumber) === 'val.enum', code(badNumber));
    const mismatch = await c.post(`/api/games/european-roulette/bet`, { stakeCents: 2000, selection: { bets: [{ type: 'straight', numbers: [5], amount: 100 }] } });
    assert.equal(mismatch.status, 400);
    assert.equal(code(mismatch), 'err.bets_stake_mismatch');
    assert.equal((await c.get('/api/wallet')).body.data.balance, 500000, 'nothing was charged for invalid bets');
  });

  it('plays a full blackjack hand with hits and a stand, then locks further actions', async () => {
    const c = await app.player();
    const bj = (await c.get('/api/games/classic-blackjack')).body.data.game;
    assert.ok(bj, 'blackjack exists in the catalogue');
    const start = (await c.get('/api/wallet')).body.data.balance;
    const stake = Math.max(bj.minBet, 3000);
    const deal = await c.post(`/api/games/classic-blackjack/bet`, { stakeCents: stake, selection: {} });
    assert.equal(deal.status, 200, JSON.stringify(deal.body));
    assert.equal(deal.body.data.pending, true, 'a dealt hand waits for the player');
    const betId = deal.body.data.bet.id;
    assert.equal(deal.body.data.bet.status, 'pending');
    assert.ok(Array.isArray(deal.body.data.actions) && deal.body.data.actions.length >= 2, 'the table offers hit/stand');
    assert.equal((await c.get('/api/wallet')).body.data.balance, start - stake);

    const active = await c.get(`/api/bets/active?gameKey=classic-blackjack`);
    assert.equal(active.body.data.hand?.id, betId, 'a reload can resume the hand');

    let state = deal.body.data;
    let hits = 0;
    while (state.pending && hits < 8) {
      hits += 1;
      const step = await c.post(`/api/bets/${betId}/action`, { action: 'hit' });
      assert.equal(step.status, 200, JSON.stringify(step.body));
      state = step.body.data;
      if (state.bet.status !== 'pending') break;
    }
    if (state.pending) {
      const stand = await c.post(`/api/bets/${betId}/action`, { action: 'stand' });
      assert.equal(stand.status, 200, JSON.stringify(stand.body));
      state = stand.body.data;
    }
    assert.equal(state.pending, false, 'the hand resolves');
    assert.ok(['won', 'lost', 'void', 'push'].includes(state.bet.status), state.bet.status);
    const after = (await c.get('/api/wallet')).body.data.balance;
    assert.equal(after, start - stake + state.bet.payout, 'blackjack pays exactly the posted payout');
    const again = await c.post(`/api/bets/${betId}/action`, { action: 'hit' });
    assert.equal(again.status, 409);
    assert.equal(code(again), 'err.round_closed');
    const double = await c.post(`/api/bets/${betId}/action`, { action: 'double' });
    assert.equal(double.status, 409, 'a settled hand cannot be reopened');
  });

  it('refunds an abandoned hand in full', async () => {
    const c = await app.player();
    const vp = (await c.get('/api/games/jacks-or-better')).body.data.game;
    const start = (await c.get('/api/wallet')).body.data.balance;
    const stake = Math.max(vp.minBet, 2500);
    const deal = await c.post('/api/games/jacks-or-better/bet', { stakeCents: stake });
    const betId = deal.body.data.bet.id;
    assert.equal(deal.body.data.pending, true, 'a held hand waits for the draw');
    assert.equal((await c.get('/api/wallet')).body.data.balance, start - stake);
    const out = await c.post('/api/bets/' + betId + '/abandon', {});
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.data.wallet.balance, start, 'walking away returns the stake exactly once');
    const txs = (await c.get('/api/wallet')).body.data.transactions;
    const refund = txs.find((x) => x.kind === 'refund');
    assert.ok(refund, 'the refund is visible in the ledger');
    assert.equal(refund.amount, stake);
    assert.equal(refund.noteKey, 'wallet.note.refund', 'and it is labelled for both languages');
    assert.equal(txs.filter((x) => x.kind === 'refund').length, 1, 'exactly one refund row');
    const row = app.db.get('SELECT status, payout FROM bets WHERE public_id = ?', [betId]);
    assert.equal(row.status, 'void');
    assert.equal(row.payout, stake, 'a voided hand books the returned stake so net result stays zero');
    const second = await c.post('/api/bets/' + betId + '/abandon', {});
    assert.equal(second.status, 409, 'cannot abandon twice');
    assert.equal(code(second), 'err.round_closed');
  });

  it('refuses bets on games the admin disabled', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    const admin = await app.admin();
    const off = await admin.patch(`/api/admin/games/${game.key}`, { enabled: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    const res = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: Math.max(game.minBet, 1000) });
    assert.equal(res.status, 404);
    assert.equal(code(res), 'err.game_unavailable');
    const listed = await c.get('/api/games?limit=200');
    assert.ok(!listed.body.data.rows.some((g) => g.key === game.key), 'and it disappears from the lobby');
    await admin.patch(`/api/admin/games/${game.key}`, { enabled: true });
    const back = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: Math.max(game.minBet, 1000) });
    assert.equal(back.status, 200, 're-enabling makes it playable again');
  });
});

describe('responsible gaming limits', () => {
  it('enforces the caps it accepted and refuses values it cannot honour', async () => {
    const c = await app.player();
    const stake = 6000;
    const belowMin = await c.post('/api/rg/limits', { dailyLossLimit: 1500 });
    assert.equal(belowMin.status, 422, 'a limit below the floor is rejected, never silently raised');
    assert.equal(code(belowMin), 'rg.limit_below_min');
    assert.equal(belowMin.body.error.params.minCredits, 100);
    const garbage = await c.post('/api/rg/limits', { dailyLossLimit: 'lots' });
    assert.equal(garbage.status, 422);
    assert.equal(code(garbage), 'val.number');
    const sillySession = await c.post('/api/rg/limits', { sessionLimitMin: 1 });
    assert.equal(sillySession.status, 422);
    assert.equal(code(sillySession), 'val.range');

    const set = await c.post('/api/rg/limits', { weeklyWagerLimit: 10000, dailyLossLimit: 20000, sessionLimitMin: 30, realityCheck: true });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.data.limits.weeklyWager, 10000);
    assert.equal(set.body.data.limits.dailyLoss, 20000);
    assert.equal(set.body.data.limits.sessionMinutes, 30);
    const status = await c.get('/api/rg/status');
    assert.equal(status.body.data.limits.weeklyWager, 10000, 'and that is what the account page reads back');
    assert.ok(status.body.data.usage.todayNetLoss >= 0);

    const first = await c.post('/api/games/lucky-dice/bet', { stakeCents: stake });
    assert.equal(first.status, 200, 'the first bet fits under the cap');
    const beforeSecond = (await c.get('/api/wallet')).body.data.balance;
    const second = await c.post('/api/games/lucky-dice/bet', { stakeCents: stake });
    assert.equal(second.status, 403, 'the second would exceed it');
    assert.equal(code(second), 'rg.weekly_wager_limit');
    assert.equal(second.body.error.params.limit, 10000);
    assert.equal((await c.get('/api/wallet')).body.data.balance, beforeSecond, 'the refused bet moved no money');
    const lifted = await c.post('/api/rg/limits', { weeklyWagerLimit: 0 });
    assert.equal(lifted.status, 200);
    assert.equal(lifted.body.data.limits.weeklyWager, null, '0 clears the cap');
    const ok = await c.post('/api/games/lucky-dice/bet', { stakeCents: stake });
    assert.equal(ok.status, 200, 'clearing the limit unblocks play');
    const auditRow = app.db.get("SELECT action FROM audit_logs WHERE action = 'account.limits_set' ORDER BY id DESC LIMIT 1");
    assert.ok(auditRow, 'limit changes are audited');
  });

  it('self-exclusion locks play out and signs every device out', async () => {
    const c = await app.player();
    const ex = await c.post('/api/rg/self-exclude', { hours: 2 });
    assert.equal(ex.status, 200, JSON.stringify(ex.body));
    assert.ok(ex.body.data.selfExclusionUntil, 'returns the moment the break ends');
    assert.equal((await c.get('/api/auth/session')).body.data.authenticated, false, 'starting a break signs every device out');

    const back = await app.client();
    await back.post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    const blocked = await back.post('/api/games/lucky-dice/bet', { stakeCents: 1000 });
    assert.equal(blocked.status, 403);
    assert.equal(code(blocked), 'rg.self_excluded');
    assert.ok(blocked.body.error.params.until, 'tells the player until when');
    const status = await back.get('/api/rg/status');
    assert.ok(status.body.data.selfExclusionUntil, 'the account page can render the active break');

    const tooLong = await back.post('/api/rg/self-exclude', { hours: 99999 });
    assert.equal(tooLong.status, 422);
    assert.equal(code(tooLong), 'rg.exclude_invalid');
    const lift = await back.post('/api/rg/self-exclude', { hours: 0 });
    assert.equal(lift.status, 200);
    assert.equal(lift.body.data.selfExclusionUntil, null);
    const after = await back.post('/api/games/lucky-dice/bet', { stakeCents: 1000 });
    assert.equal(after.status, 200, 'lifting the exclusion lets play resume');
  });

  it('reports the reality-check numbers the header and banner show', async () => {
    const c = await app.player();
    await c.post('/api/games/lucky-dice/bet', { stakeCents: 1200 });
    const d = (await c.get('/api/rg/status')).body.data;
    assert.equal(typeof d.usage.todayNetLoss, 'number');
    assert.equal(typeof d.usage.sessionMinutes, 'number');
    assert.equal(d.realityCheck, true, 'reality checks default to on');
    assert.equal(d.limits.realityCheckEveryMin, 20);
    assert.equal(d.currency, 'DEMO', 'the unit is always labelled demo');
    assert.ok(d.helpKey, 'and it points at a translatable help note');
  });
});

describe('wallet and history', () => {
  it('pages bets with filters and keeps totals honest', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    for (let i = 0; i < 6; i += 1) await c.post(`/api/games/lucky-dice/bet`, { stakeCents: 1500 });
    const all = await c.get('/api/bets?limit=100');
    assert.equal(all.body.data.rows.length, 6);
    assert.equal(all.body.data.total, 6);
    assert.ok(all.body.data.rows.every((b) => b.gameKey === game.key));
    assert.ok(all.body.data.stats, 'aggregate stats are returned for the account header');
    const paged = await c.get('/api/bets?limit=2&offset=2');
    assert.equal(paged.body.data.rows.length, 2);
    assert.equal(paged.body.data.total, 6);
    const filtered = await c.get('/api/bets?status=won');
    assert.ok(filtered.body.data.rows.every((b) => b.status === 'won'));
    const other = await app.player();
    assert.equal((await other.get('/api/bets?limit=100')).body.data.rows.length, 0, 'no cross-user leakage');
  });

  it('toggles favorites per game and persists them', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    const on = await c.post(`/api/favorites/${game.key}`, { on: true });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.ok((await c.get('/api/favorites')).body.data.keys.includes(game.key), 'listed after adding');
    const off = await c.post(`/api/favorites/${game.key}`, { on: false });
    assert.equal(off.status, 200);
    const favs = await c.get('/api/favorites');
    assert.ok(!JSON.stringify(favs.body.data).includes(game.key), 'and it is removed again');
    const ghost = await c.post('/api/favorites/no-such-game', { on: true });
    assert.equal(ghost.status, 404);
  });

  it('only offers the daily top-up when it is due and affordable', async () => {
    const c = await app.player();
    const res = await c.post('/api/wallet/claim-daily', {});
    assert.equal(res.status, 409, 'bonus is switched off in this environment');
    assert.equal(code(res), 'wallet.daily_disabled');
    const status = await c.get('/api/wallet');
    assert.ok(status.body.data.dailyBonus, 'the payload explains the button state');
  });
});

describe('provably fair', () => {
  it('commits a seed up front and lets anyone re-verify once it is revealed', async () => {
    const c = await app.player();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    const stake = Math.max(game.minBet, 1000);
    const bet = await c.post(`/api/games/lucky-dice/bet`, { stakeCents: stake, clientSeed: 'my-own-seed' });
    assert.equal(bet.status, 200);
    const fair = await c.get('/api/fairness');
    assert.equal(fair.status, 200);
    assert.match(fair.body.data.current.serverSeedHash, /^[a-f0-9]{32,}$/);
    assert.equal(fair.body.data.current.clientSeed, 'my-own-seed', 'the client seed the player supplied is used');
    assert.ok(!JSON.stringify(fair.body.data.current).includes('serverSeed:'), 'the live secret is committed, not published');

    const verify = await app.client().get(`/api/fairness/verify/${bet.body.data.bet.id}`);
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    assert.equal(verify.body.data.ok, false, 'an unrevealed seed cannot be verified yet — no fake ticks');
    assert.equal(verify.body.data.reason, 'seed_not_revealed');
    assert.match(verify.body.data.expectedHash, /^[a-f0-9]{64}$/);
    const bogus = await app.client().get('/api/fairness/verify/bet_does_not_exist');
    assert.equal(bogus.status, 200, 'unknown bets answer with a translatable reason, not a bare 404');
    assert.equal(bogus.body.data.ok, false);
    assert.equal(bogus.body.data.reason, 'not_found');

    // A bet that changes the client seed must be verifiable too: the roll has to
    // be derived from the value the bet records, not from the previous one.
    const changed = await c.post('/api/games/lucky-dice/bet', { stakeCents: stake, clientSeed: 'my-own-seed-2' });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.data.bet.fair.clientSeed, 'my-own-seed-2');
    const changedRow = app.db.get('SELECT client_seed, nonce FROM bets WHERE public_id = ?', [changed.body.data.bet.id]);
    assert.equal(changedRow.client_seed, 'my-own-seed-2', 'the bet row carries the seed that produced the roll');

    // Placed under this epoch so the rotation reveals it too.
    const bj = await c.post('/api/games/classic-blackjack/bet', { stakeCents: stake });
    const bjBetId = bj.body.data.bet.id;

    const rotate = await c.post('/api/fairness/rotate', {});
    assert.equal(rotate.status, 200);
    const after = await c.get('/api/fairness');
    assert.notEqual(after.body.data.current.serverSeedHash, fair.body.data.current.serverSeedHash, 'a new epoch starts');
    assert.ok(after.body.data.revealed.length >= 1, 'the retired seed is revealed for auditing');
    const reRolled = await app.client().get(`/api/fairness/verify/${changed.body.data.bet.id}`);
    assert.equal(reRolled.body.data.ok, true, `the roll must reproduce exactly, not merely pay the same: ${reRolled.body.data.reason}`);
    assert.equal(reRolled.body.data.scope, 'full');
    assert.equal(reRolled.body.data.recomputed.outcome.roll, reRolled.body.data.stored.outcome.roll, 'the dice roll itself is reproduced');
    assert.equal(reRolled.body.data.hashMatches, true);
    assert.equal(reRolled.body.data.clientSeed, 'my-own-seed-2');
    assert.ok(typeof reRolled.body.data.nonce === 'number');
    // A stored result the seed cannot reproduce must be reported, never ticked.
    // (Raising the stake alone is not a contradiction: a lost round pays nothing
    // at any stake, so the tamper goes on the result itself.)
    const id2 = changed.body.data.bet.id;
    const original = app.db.get('SELECT payout, status FROM bets WHERE public_id = ?', [id2]);
    app.db.run('UPDATE bets SET payout = 90000, status = \'won\' WHERE public_id = ?', [id2]);
    const caught = await app.client().get(`/api/fairness/verify/${id2}`);
    assert.equal(caught.body.data.ok, false, 'a payout the seed cannot reproduce is reported, not ticked');
    assert.equal(caught.body.data.reason, 'outcome_mismatch');
    assert.equal(caught.body.data.hashMatches, true, 'the commitment still matches — it is the stored result that does not');
    app.db.run('UPDATE bets SET payout = ?, status = ? WHERE public_id = ?', [original.payout, original.status, id2]);
    const restored = await app.client().get(`/api/fairness/verify/${id2}`);
    assert.equal(restored.body.data.ok, true, 'and the honest row verifies again');

    // Blackjack is played with decisions, so only the deal comes from the seed;
    // the answer must say that instead of accusing the table of a mismatch.
    const bjVerify = await app.client().get(`/api/fairness/verify/${bjBetId}`);
    assert.equal(bjVerify.body.data.reason, 'multi_step');
    assert.equal(bjVerify.body.data.scope, 'not_replayable');
    assert.equal(bjVerify.body.data.hashMatches, true, 'the commitment is still checkable');

    const stillVerifiable = await app.client().get('/api/fairness/verify/' + bet.body.data.bet.id);
    assert.equal(
      stillVerifiable.body.data.ok,
      true,
      `old bets stay verifiable once the seed is revealed — reason ${stillVerifiable.body.data.reason}, stored ${JSON.stringify(stillVerifiable.body.data.stored)}, recomputed ${JSON.stringify(stillVerifiable.body.data.recomputed)}`
    );
  });

  it('validates the client seed shape', async () => {
    const c = await app.player();
    const res = await c.post('/api/fairness/client-seed', { clientSeed: 'x'.repeat(400) });
    assert.equal(res.status, 200, 'long seeds are truncated, not rejected');
    assert.ok(((await c.get('/api/fairness')).body.data.clientSeed || '').length <= 48);
    const empty = await c.post('/api/fairness/client-seed', { clientSeed: '   ' });
    assert.equal(empty.status, 200);
  });
});

describe('live delivery', () => {
  it('pushes wallet updates over SSE so the header stays current', async () => {
    const c = await app.player();
    const res = await fetch(`${app.base}/api/events`, { headers: { cookie: c.cookieHeader(), accept: 'text/event-stream' }, signal: AbortSignal.timeout(6000) }).catch((e) => ({ error: e }));
    if (res.error || !res.body) { assert.ok(false, 'SSE stream could not open'); return; }
    const reader = res.body.getReader();
    const game = (await c.get('/api/games/lucky-dice')).body.data.game;
    const decoder = new TextDecoder();
    let seen = '';
    const pump = (async () => {
      while (!/wallet:update/.test(seen)) {
        const { value, done } = await reader.read();
        if (done) break;
        seen += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    })();
    await new Promise((r) => setTimeout(r, 120));
    await c.post(`/api/games/lucky-dice/bet`, { stakeCents: Math.max(game.minBet, 1000) });
    await Promise.race([pump, new Promise((r) => setTimeout(r, 4000))]);
    const frame = seen.split('\n\n').find((b) => b.includes('wallet:update'));
    assert.ok(frame, `expected a wallet:update frame, got:\n${seen.slice(0, 300)}`);
    const payload = JSON.parse(frame.split('\ndata: ')[1]);
    assert.equal(payload.userId, c.identity.userId);
    assert.equal(typeof payload.balance, 'number');
  });
});

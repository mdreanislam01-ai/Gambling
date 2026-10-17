/**
 * Sports slips, checked against the wallet ledger.
 *
 * A multi-leg "single" slip is not one bet: it opens one bet row per leg and debits
 * the stake per leg. That is exactly the shape where a platform can quietly take
 * three stakes and pay one, or credit a payout no ledger row explains — and the UI
 * shows "potential return", so the number quoted at placement has to be the number
 * paid at settlement. These tests walk a slip from placement to settlement and assert
 * the balance, the ledger and the daily rollups agree at every step.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestApp } from './helpers/app.js';

let app;
const S = {};

before(async () => { app = await bootTestApp(); });
after(async () => { await app.close(); });

const STAKE = 1000;
const pluck = (sql, params) => app.db.pluck(sql, params) ?? 0;
const balanceOf = (userId) => pluck('SELECT balance FROM user_wallets WHERE user_id = ?', [userId]);
const ledgerOf = (userId) => pluck('SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE user_id = ?', [userId]);
const today = () => pluck('SELECT bets FROM daily_stats WHERE day = date(\'now\')');
const todayWagered = () => pluck('SELECT wagered FROM daily_stats WHERE day = date(\'now\')');
const floor = (n) => Math.floor(n);

/** Every leg is a selection that wins on a 3-0 home score. */
function legsFor(fixtureId) {
  const want = [['1X2', 'home'], ['OU_2_5', 'over'], ['BTTS', 'no']];
  return want.map(([key, value]) => {
    const row = app.db.get(
      `SELECT s.id, s.odds_bps FROM sports_selections s
        JOIN sports_markets m ON m.id = s.market_id
       WHERE m.fixture_id = :f AND m.key = :k AND m.status = 'open'
         AND s.value = :v AND s.status = 'open'`,
      { f: fixtureId, k: key, v: value }
    );
    assert.ok(row, `the seeded fixture needs an open ${key}="${value}" selection`);
    return { selectionId: row.id, oddsBps: row.odds_bps, key };
  });
}

test('the seed offers a bettable football fixture with the three markets we price', () => {
  const fix = app.db.get(`
    SELECT f.id, f.home_score, f.away_score FROM sports_fixtures f
     WHERE f.status = 'scheduled' AND f.result_state = 'pending' AND f.sport <> 'cricket'
       AND (SELECT COUNT(DISTINCT m.key) FROM sports_markets m JOIN sports_selections s ON s.market_id = m.id
             WHERE m.fixture_id = f.id AND m.status = 'open' AND s.status = 'open'
               AND m.key IN ('1X2','OU_2_5','BTTS')) = 3
     LIMIT 1`);
  assert.ok(fix, 'seed must include a football fixture with 1X2, Over/Under 2.5 and BTTS');
  S.fixtureId = fix.id;
  S.legs = legsFor(fix.id);
  assert.equal(S.legs.length, 3);
});

test('a multi-leg single slip debits one stake per leg and keeps the ledger whole', async () => {
  const player = await app.player();
  S.player = player;
  const userId = player.identity.userId;
  const before = balanceOf(userId);
  const betsBefore = today();
  const wageredBefore = todayWagered();

  const res = await player.post('/api/sports/bet', {
    legs: S.legs.map(({ selectionId }) => ({ selectionId })),
    stakeCents: STAKE,
    slipType: 'single',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error || res.body));
  const data = res.body.data;
  assert.equal(data.bets.length, 3, 'three legs must open three bet rows');
  assert.equal(data.totalStake, STAKE * 3, 'a single slip stakes every leg');
  assert.equal(data.wallet.balance, before - STAKE * 3);

  const rows = app.db.all(
    `SELECT id, stake, payout, status FROM bets WHERE user_id = ? AND kind = 'sports' ORDER BY id`,
    [userId]
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.stake, STAKE);
    assert.equal(row.status, 'pending');
  }

  // The wallet, the ledger and the rollups all have to agree with what was taken.
  assert.equal(balanceOf(userId), before - STAKE * 3);
  assert.equal(ledgerOf(userId), balanceOf(userId), 'balance must equal the sum of every ledger entry');
  const debits = app.db.all(
    `SELECT amount, kind FROM transactions WHERE user_id = ? AND kind = 'bet' ORDER BY id DESC LIMIT 3`,
    [userId]
  );
  assert.equal(debits.length, 3, 'one ledger debit per leg, not one per slip');
  for (const d of debits) assert.equal(d.amount, -STAKE);
  assert.equal(today() - betsBefore, 3, 'daily_stats.bets counts each bet the slip opened');
  assert.equal(todayWagered() - wageredBefore, STAKE * 3);

  const note = app.db.get(
    `SELECT link, title_key FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  assert.equal(note?.title_key, 'sports.bet_placed');
  assert.equal(note?.link, '/account/history', 'the notification has to point at a tab the account page has');
});

test('a multi slip is one bet at combined odds, and the quote is what gets paid', async () => {
  const player = await app.player();
  S.parlay = player;
  const userId = player.identity.userId;
  const before = balanceOf(userId);

  const res = await player.post('/api/sports/bet', {
    legs: S.legs.map(({ selectionId }) => ({ selectionId })),
    stakeCents: STAKE,
    slipType: 'multi',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error || res.body));
  const data = res.body.data;
  const product = S.legs.reduce((a, l) => a * (l.oddsBps / 10000), 1);
  assert.equal(data.bets.length, 1, 'a multi slip is a single bet row');
  assert.equal(data.totalStake, STAKE, 'staked once, however many legs');
  assert.equal(balanceOf(userId), before - STAKE);
  assert.equal(ledgerOf(userId), balanceOf(userId));
  assert.ok(Math.abs(data.totalOdds - product) < 0.001, `combined odds ${data.totalOdds} vs priced ${product}`);
  S.quotedReturn = data.potentialReturn;
  assert.equal(data.potentialReturn, floor(STAKE * product), 'the UI quotes stake x combined odds');
});

test('two legs on the same market are refused, not silently merged', async () => {
  const again = await S.player.post('/api/sports/bet', {
    legs: [{ selectionId: S.legs[0].selectionId }, { selectionId: S.legs[0].selectionId }],
    stakeCents: STAKE,
    slipType: 'multi',
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'sports.duplicate_market');
});

test('settling the fixture pays every leg and the parlay exactly as quoted', async () => {
  const admin = await app.admin();
  const singleUser = S.player.identity.userId;
  const parlayUser = S.parlay.identity.userId;
  const balSingle = balanceOf(singleUser);
  const balParlay = balanceOf(parlayUser);

  const res = await admin.patch(`/api/admin/sports/fixtures/${S.fixtureId}`, {
    status: 'final', homeScore: 3, awayScore: 0,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error || res.body));

  // 3-0: home win, over 2.5, BTTS no — every leg of the slip wins.
  const expectedSingle = S.legs.reduce((sum, l) => sum + floor(STAKE * (l.oddsBps / 10000)), 0);
  const singles = app.db.all(
    `SELECT stake, payout, status FROM bets WHERE user_id = ? AND kind = 'sports' ORDER BY id`,
    [singleUser]
  );
  assert.equal(singles.length, 3);
  let paid = 0;
  for (const bet of singles) {
    assert.equal(bet.status, 'won', 'all three legs win on a 3-0 scoreline');
    assert.ok(bet.payout > bet.stake);
    paid += bet.payout;
  }
  assert.equal(paid, expectedSingle);
  assert.equal(balanceOf(singleUser), balSingle + paid, 'settlement credits only what the bets were owed');
  assert.equal(ledgerOf(singleUser), balanceOf(singleUser), 'the ledger still explains the whole balance');

  const parlay = app.db.get(
    `SELECT stake, payout, status FROM bets WHERE user_id = ? AND kind = 'sports'`,
    [parlayUser]
  );
  assert.equal(parlay.status, 'won');
  assert.equal(parlay.payout, S.quotedReturn, 'the parlay pays the return the placement quoted');
  assert.equal(balanceOf(parlayUser), balParlay + S.quotedReturn);
  assert.equal(ledgerOf(parlayUser), balanceOf(parlayUser));

  // Each leg's payout must exist as its own credit, or the parity above is luck.
  const credits = app.db.pluck(
    `SELECT COUNT(*) FROM transactions WHERE user_id = ? AND kind = 'payout'`, [singleUser]
  );
  assert.equal(credits, 3, 'one credit row per settled leg');

  const rows = app.db.all(
    `SELECT m.key, s.status FROM sports_selections s JOIN sports_markets m ON m.id = s.market_id
      WHERE s.id IN (${S.legs.map(() => '?').join(',')})`, S.legs.map((l) => l.selectionId)
  );
  for (const row of rows) assert.equal(row.status, 'won', `${row.key} settled wrong`);

  const again = await admin.post(`/api/admin/sports/fixtures/${S.fixtureId}/settle`);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.settled, 0, 'replaying settlement must not pay twice');
});

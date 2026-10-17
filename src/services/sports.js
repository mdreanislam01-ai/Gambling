import { get, run, all, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/security.js';
import { json } from '../lib/util.js';
import { debit, credit } from './wallet.js';
import { openBetRow, settleBetTx, recordDay, publicBet, assertBetable } from './bets.js';
import { notifyUser } from './notify.js';
import { broadcast } from './events.js';
import { sportsEnabled } from './settings.js';
import config from '../config.js';

export const MARKET_LABELS = {
  '1X2': 'sports.market.1x2',
  DC_1X: 'sports.market.doubleChance',
  OU_2_5: 'sports.market.totalGoals',
  BTTS: 'sports.market.btts',
  MATCH_WINNER: 'sports.market.matchWinner',
  TOTAL_RUNS: 'sports.market.totalRuns',
  TOP_SCORE: 'sports.market.topScore',
};

const hashInt = (s, mod, salt = 0) => (Number.parseInt(sha256(`${s}#${salt}`).slice(0, 8), 16) % mod + mod) % mod;

function simScript(fixture) {
  // Deterministic per fixture, so the UI never flickers and admins can replay it.
  const seed = `fixture:${fixture.id}`;
  const isCricket = fixture.sport === 'cricket';
  const total = isCricket ? 0 : [0, 1, 1, 2, 2, 3, 1, 0, 2, 3, 1, 4][hashInt(seed, 12, 1)];
  const awayGoals = isCricket ? 0 : [0, 1, 1, 0, 2, 1, 3, 2, 1, 0, 2, 2][hashInt(seed, 12, 2)];
  const homeRuns = isCricket ? 120 + hashInt(seed, 90, 3) : 0;
  const awayRuns = isCricket ? 110 + hashInt(seed, 100, 4) : 0;
  const homeEvents = [];
  const awayEvents = [];
  for (let i = 0; i < total; i += 1) homeEvents.push(8 + hashInt(`${seed}h${i}`, 74, i + 5));
  for (let i = 0; i < awayGoals; i += 1) awayEvents.push(12 + hashInt(`${seed}a${i}`, 70, i + 40));
  return {
    sport: fixture.sport,
    lengthMinutes: isCricket ? 210 : 105,
    homeFinal: isCricket ? homeRuns : total,
    awayFinal: isCricket ? awayRuns : awayGoals,
    homeEvents: homeEvents.sort((a, b) => a - b),
    awayEvents: awayEvents.sort((a, b) => a - b),
    winner: isCricket ? (homeRuns >= awayRuns ? 'home' : 'away') : total > awayGoals ? 'home' : total < awayGoals ? 'away' : 'draw',
  };
}

/** State of a demo fixture at a point in time (used by the live simulation). */
export function fixtureProgress(fixture, at = Date.now()) {
  const kickoff = Date.parse(String(fixture.kickoff).replace(' ', 'T') + 'Z');
  const script = simScript(fixture);
  const elapsed = Math.floor((at - kickoff) / 60000);
  if (elapsed < 0) return { status: 'scheduled', minute: null, home: null, away: null, script };
  if (elapsed >= script.lengthMinutes) {
    return { status: 'final', minute: script.lengthMinutes, home: script.homeFinal, away: script.awayFinal, script };
  }
  const minute = Math.max(1, Math.min(script.lengthMinutes - 1, elapsed));
  const home = script.homeEvents.filter((m) => m <= minute).length;
  const away = script.awayEvents.filter((m) => m <= minute).length;
  if (fixture.sport === 'cricket') {
    const prog = minute / script.lengthMinutes;
    return {
      status: 'live', minute,
      home: Math.round(script.homeFinal * Math.min(1, prog * 1.02)),
      away: Math.round(script.awayFinal * Math.min(1, prog * 0.98)),
      overs: Math.min(fixture.sport === 'cricket' ? 20 : 20, Math.floor((minute / script.lengthMinutes) * 40)),
      script,
    };
  }
  return { status: 'live', minute, home, away, script };
}

/** Advance demo fixtures (scheduled → live → final) and settle every affected bet. */
export function tickFixtures() {
  if (!sportsEnabled()) return { advanced: 0, settled: 0 };
  const rows = all(`SELECT * FROM sports_fixtures WHERE source = 'demo' AND status IN ('scheduled','live') ORDER BY kickoff LIMIT 200`);
  let settled = 0;
  let advanced = 0;
  for (const f of rows) {
    const p = fixtureProgress(f);
    if (p.status !== f.status || p.home !== f.home_score) {
      run(`UPDATE sports_fixtures SET status = :s, minute = :m, home_score = :h, away_score = :a, updated_at = datetime('now') WHERE id = :id`,
        { s: p.status, m: p.minute, h: p.home, a: p.away, id: f.id });
      advanced += 1;
      broadcast('sports:update', { fixtureId: f.id, status: p.status, minute: p.minute, home: p.home, away: p.away });
    }
    if (p.status === 'final' && f.result_state === 'pending') { settleFixture(f.id, { source: 'auto' }); settled += 1; }
  }
  return { advanced, settled };
}

export function listLeagues({ sport = null } = {}) {
  return all(`SELECT * FROM sports_leagues ${sport ? 'WHERE sport = :s' : ''} ORDER BY sort, name`, { s: sport })
    .map((r) => ({ id: r.id, key: r.key, name: r.name, nameKey: r.name_key, sport: r.sport, country: r.country, flag: r.flag, active: !!r.active }));
}

const shapeFixture = (f) => ({
  id: f.id,
  sport: f.sport,
  league: f.league_name ? { id: f.league_id, name: f.league_name, nameKey: f.league_name_key, country: f.country, flag: f.flag, sport: f.sport } : null,
  home: { id: f.home_team_id, name: f.home_team, short: f.home_short, color: f.home_color },
  away: { id: f.away_team_id, name: f.away_team, short: f.away_short, color: f.away_color },
  kickoff: f.kickoff,
  status: f.status,
  minute: f.minute,
  score: { home: f.home_score, away: f.away_score },
  venue: f.venue,
  round: f.round,
  season: f.season,
  source: f.source,
  simulated: f.source === 'demo',
  detail: json(f.detail, null),
  markets: f.markets ? json(f.markets, []) : undefined,
});

const FIXTURE_SELECT = `
  SELECT f.*, l.name AS league_name, l.name_key AS league_name_key, l.country, l.flag,
         h.name AS home_team, h.short AS home_short, h.color AS home_color,
         a.name AS away_team, a.short AS away_short, a.color AS away_color
  FROM sports_fixtures f
  LEFT JOIN sports_leagues l ON l.id = f.league_id
  LEFT JOIN sports_teams h ON h.id = f.home_team_id
  LEFT JOIN sports_teams a ON a.id = f.away_team_id`;

export function listFixtures({ sport = null, status = null, leagueId = null, search = null, limit = 30, offset = 0, withMarkets = true, from = null } = {}) {
  const p = { limit: Math.min(100, Math.max(1, limit)), offset: Math.max(0, offset) };
  const where = ['1=1'];
  if (sport) { where.push('f.sport = :sport'); p.sport = sport; }
  if (status === 'today') where.push(`date(f.kickoff) = date('now')`);
  else if (status === 'upcoming') where.push(`f.status = 'scheduled' AND f.kickoff >= datetime('now','-2 hours')`);
  else if (status === 'live') where.push(`f.status = 'live'`);
  else if (status === 'results') where.push(`f.status = 'final'`);
  else if (status) { where.push('f.status = :status'); p.status = status; }
  if (leagueId) { where.push('f.league_id = :leagueId'); p.leagueId = Number(leagueId) || 0; }
  if (from) { where.push('f.kickoff >= :from'); p.from = from; }
  if (search) {
    where.push('(h.name LIKE :q OR a.name LIKE :q OR l.name LIKE :q)');
    p.q = `%${String(search).slice(0, 50)}%`;
  }
  const rows = all(`${FIXTURE_SELECT} WHERE ${where.join(' AND ')} ORDER BY
      CASE f.status WHEN 'live' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, f.kickoff ASC LIMIT :limit OFFSET :offset`, p);
  const withMarketsRows = withMarkets ? attachMarkets(rows) : rows;
  return {
    rows: withMarketsRows.map((f) => shapeFixture(f)),
    total: get(`SELECT COUNT(*) c FROM sports_fixtures f ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, p)?.c ?? 0,
    liveData: config.sports.liveEnabled,
  };
}

function attachMarkets(rows) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return rows;
  const list = ids.map(() => '?').join(',');
  const markets = all(
    `SELECT m.*, s.id AS sel_id, s.label, s.label_key AS labelKey, s.value, s.odds_bps AS oddsBps, s.status AS sel_status, s.sort AS sel_sort
     FROM sports_markets m JOIN sports_selections s ON s.market_id = m.id
     WHERE m.fixture_id IN (${list}) AND m.status != 'settled' ORDER BY m.sort, s.sort`, ids
  );
  const byFixture = new Map();
  for (const m of markets) {
    if (!byFixture.has(m.fixture_id)) byFixture.set(m.fixture_id, new Map());
    const mk = byFixture.get(m.fixture_id);
    if (!mk.has(m.id)) mk.set(m.id, { id: m.id, key: m.key, label: m.label, labelKey: m.label_key, kind: m.kind, status: m.status, selections: [] });
    mk.get(m.id).selections.push({ id: m.sel_id, label: m.label, labelKey: m.labelKey, value: m.value, oddsBps: m.oddsBps, status: m.sel_status });
  }
  return rows.map((r) => ({ ...r, markets: JSON.stringify([...(byFixture.get(r.id)?.values() ?? [])]) }));
}

export function getFixture(id) {
  const row = get(`${FIXTURE_SELECT} WHERE f.id = :id`, { id: Number(id) || 0 });
  if (!row) return null;
  const markets = all(
    `SELECT m.*, s.id AS sel_id, s.label, s.label_key AS sel_label_key, s.value, s.odds_bps AS odds_bps, s.status AS sel_status
     FROM sports_markets m JOIN sports_selections s ON s.market_id = m.id WHERE m.fixture_id = :id ORDER BY m.sort, s.sort`,
    { id }
  );
  const grouped = new Map();
  for (const m of markets) {
    if (!grouped.has(m.id)) grouped.set(m.id, { id: m.id, key: m.key, label: m.label, labelKey: m.label_key, kind: m.kind, status: m.status, selections: [] });
    grouped.get(m.id).selections.push({ id: m.sel_id, label: m.label, labelKey: m.sel_label_key, value: m.value, oddsBps: m.odds_bps, status: m.sel_status });
  }
  return { ...shapeFixture(row), marketList: [...grouped.values()] };
}

/** Outcome of one market selection for a finished fixture. */
export function evalSelection(marketKey, value, fixture) {
  const h = Number(fixture.home_score ?? 0);
  const a = Number(fixture.away_score ?? 0);
  const v = String(value ?? '');
  const num = Number(v);
  switch (marketKey) {
    case '1X2': return h > a ? (v === 'home' ? 'won' : 'lost') : h < a ? (v === 'away' ? 'won' : 'lost') : v === 'draw' ? 'won' : 'lost';
    case 'MATCH_WINNER': return h === a ? 'void' : h > a ? (v === 'home' ? 'won' : 'lost') : v === 'away' ? 'won' : 'lost';
    case 'DC_1X': return (h >= a ? v === '1X' : v === '2') ? 'won' : 'lost';
    case 'DC_12': return (h !== a) ? 'won' : 'lost';
    case 'DC_X2': return (h <= a ? v === 'X2' : v === '1') ? 'won' : 'lost';
    case 'OU_2_5': return h + a > 2.5 ? (v === 'over' ? 'won' : 'lost') : v === 'under' ? 'won' : 'lost';
    case 'OU_1_5': return h + a > 1.5 ? (v === 'over' ? 'won' : 'lost') : v === 'under' ? 'won' : 'lost';
    case 'BTTS': return h > 0 && a > 0 ? (v === 'yes' ? 'won' : 'lost') : v === 'no' ? 'won' : 'lost';
    case 'TOTAL_RUNS': return h + a > num ? (v === 'over' ? 'won' : 'lost') : v === 'under' ? 'won' : 'lost';
    default: return 'void';
  }
}

export function placeSportsBet({ user, legs, stake, slipType = 'single' }) {
  if (!sportsEnabled()) throw new HttpError(503, 'err.sports_disabled');
  const s = Math.round(Number(stake));
  if (!Number.isFinite(s) || s < 100) throw new HttpError(400, 'err.stake_invalid');
  const list = Array.isArray(legs) ? legs.slice(0, 12) : [];
  if (!list.length) throw new HttpError(400, 'sports.slip_empty');
  return tx(() => {
    const resolved = list.map((leg) => {
      const row = get(
        `SELECT sel.id, sel.market_id, sel.label, sel.value, sel.odds_bps, sel.status AS sel_status,
                m.key AS market_key, m.status AS market_status, f.id AS fixture_id, f.status AS fixture_status, f.result_state
         FROM sports_selections sel
         JOIN sports_markets m ON m.id = sel.market_id
         JOIN sports_fixtures f ON f.id = m.fixture_id
         WHERE sel.id = :id`, { id: Number(leg.selectionId) || 0 }
      );
      if (!row) throw new HttpError(404, 'sports.selection_not_found', { id: leg.selectionId });
      if (row.sel_status !== 'open' || row.market_status !== 'open') throw new HttpError(409, 'sports.selection_suspended', { selectionId: row.id });
      if (!['scheduled', 'live'].includes(row.fixture_status)) throw new HttpError(409, 'sports.fixture_closed', { fixtureId: row.fixture_id });
      if (row.result_state !== 'pending') throw new HttpError(409, 'sports.fixture_settled', { fixtureId: row.fixture_id });
      return row;
    });
    const seen = new Set();
    for (const r of resolved) {
      const k = `${r.fixture_id}:${r.market_key}`;
      if (seen.has(k)) throw new HttpError(409, 'sports.duplicate_market', { market: r.market_key, fixtureId: r.fixture_id });
      seen.add(k);
    }
    const totalOdds = resolved.reduce((a, r) => a * (r.odds_bps / 10000), 1);
    if (totalOdds > 200) throw new HttpError(400, 'sports.odds_cap', { cap: 200 });
    const u = get(`SELECT * FROM users WHERE id = :id`, { id: user.id });
    const per = resolved.length;
    const totalStake = slipType === 'multi' ? s : s * per;
    // Same responsible-gaming / balance / status gates as the casino, applied to
    // every stake that will actually be debited.
    for (let i = 0; i < (slipType === 'multi' ? 1 : per); i += 1) assertBetable(u, SPORT_GAME, s);
    const out = [];
    if (slipType === 'multi') {
      debit({ userId: user.id, amount: s, noteKey: 'wallet.note.stake' });
      recordDay({ wagered: s, paid: 0 });
      const bet = openBetRow({
        userId: user.id, kind: 'sports', gameKey: null, stake: s, fixtureId: resolved[0].fixture_id,
        selection: { type: 'multi', legs: resolved.map((r) => ({ selectionId: r.id, marketKey: r.market_key, label: r.label, value: r.value, oddsBps: r.odds_bps, fixtureId: r.fixture_id })) },
      });
      out.push(publicBet(get(`SELECT b.*, NULL AS game_name FROM bets b WHERE b.id = :id`, { id: bet.id })));
    } else {
      for (const r of resolved) {
        debit({ userId: user.id, amount: s, noteKey: 'wallet.note.stake' });
        // One entry per slip leg, because a multi-leg single slip really is that
        // many bets — the daily counter has to match the number of bet rows opened.
        recordDay({ wagered: s, paid: 0 });
        const bet = openBetRow({
          userId: user.id, kind: 'sports', gameKey: null, stake: s, fixtureId: r.fixture_id,
          selection: { type: 'single', legs: [{ selectionId: r.id, marketKey: r.market_key, label: r.label, value: r.value, oddsBps: r.odds_bps, fixtureId: r.fixture_id }] },
        });
        run(`UPDATE bets SET payout = 0 WHERE id = :id`, { id: bet.id });
        out.push(publicBet(get(`SELECT b.*, NULL AS game_name FROM bets b WHERE b.id = :id`, { id: bet.id })));
      }
    }
    notifyUser(user.id, {
      titleKey: 'sports.bet_placed', bodyKey: 'sports.bet_placed_body',
      params: { count: out.length, stake: totalStake, odds: Math.round(totalOdds * 1000) / 1000 },
      level: 'info', icon: 'ticket', link: '/account/history',
    });
    broadcast('sports:bet', { userId: user.id, count: out.length });
    return { bets: out, totalStake, totalOdds: Math.round(totalOdds * 10000) / 10000, potentialReturn: Math.floor(slipType === 'multi' ? s * totalOdds : s * resolved[0].odds_bps / 10000) };
  });
}

/** Synthetic "game" row so sports bets share the casino's guard rails. */
export const SPORT_GAME = Object.freeze({
  key: 'sports', engine: 'sports', name: 'Sports', enabled: 1, visibility: 'public',
  minBet: 100, maxBet: 5000000, min_bet: 100, max_bet: 5000000,
});

export function settleFixture(fixtureId, { source = 'admin' } = {}) {
  return tx(() => {
    const fixture = get(`SELECT * FROM sports_fixtures WHERE id = :id`, { id: fixtureId });
    if (!fixture) throw new HttpError(404, 'sports.fixture_not_found');
    const bets = all(`SELECT * FROM bets WHERE kind = 'sports' AND status = 'pending' AND fixture_id = :id`, { id: fixtureId });
    let settledCount = 0;
    for (const bet of bets) {
      const sel = json(bet.selection, { legs: [] });
      const legs = sel.legs.map((l) => ({ ...l, result: fixture.status === 'cancelled' || fixture.status === 'postponed' ? 'void' : evalSelection(l.marketKey, l.value, fixture) }));
      const anyVoid = legs.some((l) => l.result === 'void');
      const allWon = legs.every((l) => l.result === 'won');
      const anyLost = legs.some((l) => l.result === 'lost');
      let payout = 0;
      let status = 'lost';
      if (allWon) {
        payout = Math.floor(bet.stake * legs.reduce((a, l) => a * (l.oddsBps / 10000), 1));
        status = 'won';
      } else if (anyVoid && !anyLost) { status = 'void'; payout = bet.stake; }
      settleBetTx({ betId: bet.id, status, payout, outcome: { legs, settledBy: source, fixtureStatus: fixture.status, score: { home: fixture.home_score, away: fixture.away_score } } });
      for (const l of legs) run(`UPDATE sports_selections SET status = :s WHERE id = :id`, { s: l.result, id: l.selectionId });
      if (payout > bet.stake) {
        notifyUser(bet.user_id, { titleKey: 'sports.bet_won', bodyKey: 'sports.bet_won_body', params: { amount: payout, fixture: fixtureId }, level: 'success', icon: 'trophy', link: '/account/history' });
      } else if (status === 'lost') {
        notifyUser(bet.user_id, { titleKey: 'sports.bet_lost', bodyKey: 'sports.bet_lost_body', params: { fixture: fixtureId }, level: 'info', icon: 'ticket', link: '/account/history' });
      }
      settledCount += 1;
    }
    run(`UPDATE sports_fixtures SET result_state = 'settled', updated_at = datetime('now') WHERE id = :id`, { id: fixtureId });
    run(`UPDATE sports_markets SET status = 'settled' WHERE fixture_id = :id`, { id: fixtureId });
    broadcast('sports:settled', { fixtureId, settledCount, source });
    return { settled: settledCount, fixtureId };
  });
}

export function pendingSportsBetCount(fixtureId) {
  return get(`SELECT COUNT(*) c FROM bets WHERE kind = 'sports' AND status = 'pending' AND fixture_id = :id`, { id: fixtureId })?.c ?? 0;
}

export function suspendMarkets(fixtureId, suspend = true) {
  run(`UPDATE sports_markets SET status = :s WHERE fixture_id = :id`, { s: suspend ? 'suspended' : 'open', id: fixtureId });
  run(`UPDATE sports_selections SET status = :s WHERE status = 'open' AND market_id IN (SELECT id FROM sports_markets WHERE fixture_id = :id)`, { s: suspend ? 'suspended' : 'open', id: fixtureId });
  broadcast('sports:suspend', { fixtureId, suspended: suspend });
}

export function adminListFixtures({ status = null, sport = null, q = null, limit = 50, offset = 0 } = {}) {
  const p = { limit: Math.min(200, Math.max(1, limit)), offset: Math.max(0, offset) };
  const where = ['1=1'];
  if (status) { where.push('f.status = :status'); p.status = status; }
  if (sport) { where.push('f.sport = :sport'); p.sport = sport; }
  if (q) { where.push('(h.name LIKE :q OR a.name LIKE :q)'); p.q = `%${String(q).slice(0, 40)}%`; }
  const rows = all(`${FIXTURE_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.kickoff DESC LIMIT :limit OFFSET :offset`, p);
  return {
    rows: rows.map((r) => ({
      ...shapeFixture(r),
      pendingBets: get(`SELECT COUNT(*) c FROM bets WHERE kind='sports' AND status='pending' AND fixture_id = :id`, { id: r.id })?.c ?? 0,
      resultState: r.result_state,
    })),
    total: get(`SELECT COUNT(*) c FROM sports_fixtures f ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, p)?.c ?? 0,
  };
}

export function updateFixture(actor, id, patch, ip) {
  const fields = [];
  const p = { id: Number(id) };
  for (const [k, col] of Object.entries({ status: 'status', minute: 'minute', homeScore: 'home_score', awayScore: 'away_score', kickoff: 'kickoff', source: 'source', liveSim: 'live_sim' })) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (k === 'liveSim') v = v ? 1 : 0;
    if (k === 'minute' || k === 'homeScore' || k === 'awayScore') v = v === null || v === '' ? null : Math.round(Number(v));
    if (k === 'status' && !['scheduled', 'live', 'final', 'postponed', 'cancelled'].includes(v)) throw new HttpError(422, 'val.enum', { field: 'status' });
    fields.push(`${col} = :${k}`);
    p[k] = v;
  }
  if (!fields.length) return getFixture(id);
  run(`UPDATE sports_fixtures SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = :id`, p);
  import('./audit.js').then((m) => m.audit({ actorId: actor?.id, actorRole: actor?.role, action: 'admin.fixture_updated', entity: 'fixture', entityId: id, meta: patch, ip }));
  if (patch.status === 'final' || patch.status === 'cancelled' || patch.status === 'postponed') {
    try { settleFixture(Number(id), { source: 'admin' }); } catch (err) { import('./audit.js').then((m) => m.logError({ code: 'sports.settle', message: err.message })); }
  }
  broadcast('sports:update', { fixtureId: Number(id), status: patch.status });
  return getFixture(id);
}

/** Create the standard market set for a fixture (demo odds, 4-6 % margin). */
export function buildMarketsFor(f) {
  const script = simScript(f);
  const s = script.homeFinal || 1;
  const a = script.awayFinal || 1;
  const margin = 1.06;
  const odds = (p) => Math.max(10100, Math.round((10000 / Math.max(0.02, Math.min(0.97, p))) * (1 / margin)));
  const isCricket = f.sport === 'cricket';
  const ph = isCricket ? (s >= a ? 0.62 : 0.42) : s > a ? 0.45 : s < a ? 0.3 : 0.33;
  const pa = isCricket ? (a > s ? 0.62 : 0.42) : a > s ? 0.45 : a < s ? 0.3 : 0.33;
  const pd = isCricket ? 0 : Math.max(0, 1 - ph - pa);
  const markets = isCricket
    ? [
        { key: 'MATCH_WINNER', label: 'Match Winner', labelKey: 'sports.market.matchWinner', kind: '2way', sort: 1, selections: [
          { label: 'Home', labelKey: 'sports.side.home', value: 'home', oddsBps: odds(ph) },
          { label: 'Away', labelKey: 'sports.side.away', value: 'away', oddsBps: odds(pa) },
        ] },
        { key: 'TOTAL_RUNS', label: 'Total runs', labelKey: 'sports.market.totalRuns', kind: '2way', sort: 2, selections: [
          { label: 'Over 260.5', labelKey: 'sports.over', value: '260.5', oddsBps: odds(0.5) },
          { label: 'Under 260.5', labelKey: 'sports.under', value: '260.5', oddsBps: odds(0.5) },
        ] },
      ]
    : [
        { key: '1X2', label: 'Full time result', labelKey: 'sports.market.1x2', kind: '3way', sort: 1, selections: [
          { label: 'Home', labelKey: 'sports.side.home', value: 'home', oddsBps: odds(ph) },
          { label: 'Draw', labelKey: 'sports.side.draw', value: 'draw', oddsBps: odds(pd || 0.28) },
          { label: 'Away', labelKey: 'sports.side.away', value: 'away', oddsBps: odds(pa) },
        ] },
        { key: 'DC_1X', label: 'Double chance', labelKey: 'sports.market.doubleChance', kind: '2way', sort: 2, selections: [
          { label: '1X', labelKey: 'sports.dc.1x', value: '1X', oddsBps: odds(ph + pd) },
          { label: '2', labelKey: 'sports.side.away', value: '2', oddsBps: odds(pa) },
        ] },
        { key: 'OU_2_5', label: 'Total goals 2.5', labelKey: 'sports.market.totalGoals', kind: '2way', sort: 3, selections: [
          { label: 'Over 2.5', labelKey: 'sports.over', value: 'over', oddsBps: odds(0.48) },
          { label: 'Under 2.5', labelKey: 'sports.under', value: 'under', oddsBps: odds(0.52) },
        ] },
        { key: 'BTTS', label: 'Both teams to score', labelKey: 'sports.market.btts', kind: '2way', sort: 4, selections: [
          { label: 'Yes', labelKey: 'sports.yes', value: 'yes', oddsBps: odds(0.5) },
          { label: 'No', labelKey: 'sports.no', value: 'no', oddsBps: odds(0.5) },
        ] },
      ];
  const fixtureId = f.id;
  run(`DELETE FROM sports_markets WHERE fixture_id = :id`, { id: fixtureId });
  for (const m of markets) {
    const r = run(`INSERT INTO sports_markets(fixture_id, key, label, label_key, kind, sort) VALUES(:f,:k,:l,:lk,:kind,:s)`,
      { f: fixtureId, k: m.key, l: m.label, lk: m.labelKey, kind: m.kind, s: m.sort });
    const marketId = Number(r.lastInsertRowid);
    for (const [i, sel] of m.selections.entries()) {
      run(`INSERT INTO sports_selections(market_id, label, label_key, value, odds_bps, sort) VALUES(:m,:l,:lk,:v,:o,:s)`,
        { m: marketId, l: sel.label, lk: sel.labelKey, v: sel.value, o: sel.oddsBps, s: i });
    }
  }
}

export const providers = {
  liveConfigured: () => config.sports.liveEnabled,
  name: () => config.sports.provider,
};

/** Provider upsert: real fixtures keep source='provider' and are never simulated. */
export function upsertProviderFixture(f) {
  const leagueId = ensureLeague(f);
  const homeId = ensureTeam(f.home, leagueId, f.sport);
  const awayId = ensureTeam(f.away, leagueId, f.sport);
  const existing = get(`SELECT id FROM sports_fixtures WHERE external_id = :e AND source = 'provider'`, { e: f.externalId });
  if (existing) {
    run(
      `UPDATE sports_fixtures SET kickoff = :k, status = :s, minute = :m, home_score = :h, away_score = :a,
              league_id = :l, updated_at = datetime('now') WHERE id = :id`,
      { k: f.kickoff, s: f.status, m: f.minute, h: f.homeScore, a: f.awayScore, l: leagueId, id: existing.id }
    );
    if (f.status === 'final') settleFixture(existing.id, { source: 'provider' });
    return { id: existing.id, updated: true };
  }
  const r = run(
    `INSERT INTO sports_fixtures(external_id, league_id, sport, home_team_id, away_team_id, kickoff, status, minute, home_score, away_score, source, live_sim)
     VALUES(:e,:l,:sp,:h,:a,:k,:s,:m,:hs,:as,'provider',0)`,
    { e: f.externalId, l: leagueId, sp: f.sport, h: homeId, a: awayId, k: f.kickoff, s: f.status, m: f.minute, hs: f.homeScore, as: f.awayScore }
  );
  const id = Number(r.lastInsertRowid);
  seedMarketsForFixture(id, f.sport);
  if (f.status === 'final') settleFixture(id, { source: 'provider' });
  return { id, updated: false };
}

function ensureLeague(f) {
  const key = String(f.league?.key || f.league || 'provider-league').slice(0, 40);
  const found = get(`SELECT id FROM sports_leagues WHERE key = :k`, { k: key });
  if (found) return found.id;
  const r = run(
    `INSERT INTO sports_leagues(key, name, name_key, sport, country, active) VALUES(:k,:n,:nk,:s,:c,1)`,
    { k: key, n: String(f.league?.name || key).slice(0, 80), nk: 'sports.league.provider', s: f.sport, c: f.league?.country || null }
  );
  return Number(r.lastInsertRowid);
}

function ensureTeam(name, leagueId, sport) {
  const n = String(name || 'TBD').slice(0, 60);
  const found = get(`SELECT id FROM sports_teams WHERE name = :n AND sport = :s`, { n, s: sport });
  if (found) return found.id;
  const r = run(`INSERT INTO sports_teams(league_id, name, short, sport) VALUES(:l,:n,:sh,:s)`, {
    l: leagueId, n, sh: n.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(), s: sport,
  });
  return Number(r.lastInsertRowid);
}

/** Odds for provider fixtures come from the provider; demo rows are seeded. */
function seedMarketsForFixture(fixtureId, sport) {
  const exists = get(`SELECT COUNT(*) c FROM sports_markets WHERE fixture_id = :id`, { id: fixtureId })?.c ?? 0;
  if (exists) return;
  const f = get(`SELECT * FROM sports_fixtures WHERE id = :id`, { id: fixtureId });
  buildMarketsFor(f);
}

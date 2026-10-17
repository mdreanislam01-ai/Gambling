import { HttpError } from '../lib/http.js';
import { get, all } from '../db/index.js';
import { clamp } from '../lib/util.js';
import config from '../config.js';
import * as sports from '../services/sports.js';
import { providerEnabled, fetchFixtures } from '../services/provider.js';
import { walletSummary } from '../services/wallet.js';
import { readStake } from './auth.js';
import { json } from '../lib/util.js';

export function registerSportsRoutes(route) {
  // Fixtures with markets and prices, filtered by sport, league, status or date.
  route('GET', '/api/sports/fixtures', (ctx) => {
    const out = sports.listFixtures({
      sport: ctx.query.sport || null,
      status: ctx.query.status || null,
      leagueId: ctx.query.leagueId || null,
      search: ctx.query.q || null,
      limit: clamp(Number(ctx.query.limit) || 30, 1, 100),
      offset: Math.max(0, Number(ctx.query.offset) || 0),
    });
    return {
      ...out,
      liveData: providerEnabled(),
      noticeKey: providerEnabled() ? null : 'sports.demo_notice',
      leagues: sports.listLeagues().slice(0, 40),
    };
  });

  // Leagues and competitions with fixture counts, for the sidebar.
  route('GET', '/api/sports/leagues', (ctx) => ({ rows: sports.listLeagues({ sport: ctx.query.sport || null }) }));

  // One fixture: teams, scoreboard, every market and the demo result source.
  route('GET', '/api/sports/fixtures/:id', (ctx) => {
    const f = sports.getFixture(ctx.params.id);
    if (!f) throw new HttpError(404, 'sports.fixture_not_found');
    const myBets = ctx.user
      ? all(`SELECT public_id, stake, payout, status, selection, created_at FROM bets WHERE user_id = :u AND fixture_id = :f ORDER BY id DESC LIMIT 20`,
        { u: ctx.user.id, f: Number(ctx.params.id) }).map((b) => ({ ...b, selection: json(b.selection, {}) }))
      : [];
    return { fixture: f, myBets, simulated: f.source === 'demo' };
  });

  // Place a demo slip: single or multi, priced from the stored selection odds.
  route('POST', '/api/sports/bet', { auth: true, limit: 'bet' }, (ctx) => {
    const legs = Array.isArray(ctx.body?.legs) ? ctx.body.legs : [];
    const stake = readStake(ctx.body);
    const out = sports.placeSportsBet({ user: ctx.rawUser ?? ctx.user, legs, stake, slipType: ctx.body?.slipType === 'multi' ? 'multi' : 'single' });
    return { ...out, wallet: walletSummary(ctx.user.id), currency: config.demo.currency };
  });

  // Whether a provider is connected, when data last synced, and the demo-data flag.
  route('GET', '/api/sports/status', () => ({
    provider: config.sports.provider,
    liveData: providerEnabled(),
    refreshSeconds: config.sports.refreshS,
    demoFixtures: get(`SELECT COUNT(*) c FROM sports_fixtures WHERE source = 'demo'`)?.c ?? 0,
    providerFixtures: get(`SELECT COUNT(*) c FROM sports_fixtures WHERE source = 'provider'`)?.c ?? 0,
    explanationKey: providerEnabled() ? 'sports.provider_live' : 'sports.demo_only',
  }));

  // Ask the configured provider for fresh scores. With no provider it says so instead of inventing any.
  route('POST', '/api/sports/refresh', { auth: 'admin' }, async () => {
    if (!providerEnabled()) throw new HttpError(409, 'sports.provider_not_configured');
    const r = await fetchFixtures();
    if (!r.ok) return { ok: false, reason: r.reason, fixtures: r.fixtures?.length ?? 0 };
    let updated = 0;
    for (const f of r.fixtures) { sports.upsertProviderFixture(f); updated += 1; }
    return { ok: true, updated, fetchedAt: r.fetchedAt };
  });
}

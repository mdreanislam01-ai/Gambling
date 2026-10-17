import config from '../config.js';
import { logError } from './audit.js';

/**
 * Optional sports-data adapter.
 *
 * Live scores are NEVER fabricated. The app ships with clearly-labelled demo
 * fixtures only. To show real data, configure a licensed provider:
 *   SPORTS_PROVIDER=generic  SPORTS_PROVIDER_BASE_URL=https://api.provider.tld  SPORTS_PROVIDER_KEY=...
 * The provider must grant written approval for gambling use.
 *
 * Expected provider response (map it in `mapFixture` if it differs):
 *   GET {base}/fixtures?status=scheduled,live&limit=50
 *   [{ "id","sport","league","home","away","start","status","minute","home_score","away_score" }]
 */
export const providerEnabled = () => config.sports.liveEnabled;

export async function fetchFixtures({ timeoutMs = 6000 } = {}) {
  if (!providerEnabled()) return { ok: false, reason: 'not_configured', fixtures: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = new URL(`${config.sports.baseUrl.replace(/\/$/, '')}/fixtures?limit=50`);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', authorization: `Bearer ${config.sports.key}`, 'user-agent': 'ArenaPlay/1.0 (demo integration)' },
    });
    if (!res.ok) throw new Error(`provider_http_${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : data?.data || data?.response || [];
    return { ok: true, fixtures: list.map(mapFixture).filter(Boolean), fetchedAt: new Date().toISOString() };
  } catch (err) {
    logError({ code: 'sports.provider', message: err.message, meta: { baseUrl: config.sports.baseUrl } });
    return { ok: false, reason: 'fetch_failed', error: String(err.message).slice(0, 200), fixtures: [] };
  } finally {
    clearTimeout(timer);
  }
}

const mapFixture = (f) => {
  if (!f || !f.id || !f.start) return null;
  const kick = new Date(f.start);
  if (Number.isNaN(kick.getTime())) return null;
  return {
    externalId: String(f.id),
    sport: ['football', 'cricket'].includes(f.sport) ? f.sport : 'football',
    league: f.league || null,
    home: f.home || null,
    away: f.away || null,
    kickoff: kick.toISOString().replace('T', ' ').slice(0, 19),
    status: ['scheduled', 'live', 'final', 'postponed', 'cancelled'].includes(f.status) ? f.status : 'scheduled',
    minute: Number.isFinite(Number(f.minute)) ? Number(f.minute) : null,
    homeScore: Number.isFinite(Number(f.home_score)) ? Number(f.home_score) : null,
    awayScore: Number.isFinite(Number(f.away_score)) ? Number(f.away_score) : null,
  };
};

/** Pull provider data and upsert real fixtures (never overwrites demo rows). */
export async function syncFixtures() {
  const { ok, fixtures, reason } = await fetchFixtures();
  if (!ok) return { ok: false, reason, updated: 0 };
  let updated = 0;
  const { upsertProviderFixture } = await import('./sports.js');
  for (const f of fixtures) {
    try {
      upsertProviderFixture(f);
      updated += 1;
    } catch (err) {
      logError({ code: 'sports.sync_fixture', message: err.message, meta: { externalId: f.externalId } });
    }
  }
  return { ok: true, updated, fetched: fixtures.length };
}

/**
 * Vercel entry point.
 *
 * ArenaPlay is a long-running Node server (`src/server.js`); on Vercel it runs
 * as a serverless function instead. This module boots the same stack once per
 * function instance (SQLite in /tmp, migrations, demo seed, crash/live game
 * engines) and forwards every request to the shared request handler, so
 * `vercel.json` can route the whole site — API, templated HTML and static
 * assets — through one place.
 *
 * Trade-offs versus a VPS deployment (see DEPLOYMENT.md):
 *   - the database lives in /tmp and resets on a cold start;
 *   - in-process game clocks only tick while the instance is warm;
 *   - /api/events (SSE) reconnects when a function hits its max duration.
 */

import crypto from 'node:crypto';

// Environment fallbacks must run before any `src/` module is imported, because
// `src/config.js` reads and freezes the environment at import time and refuses
// to boot in production without a SESSION_SECRET. On Vercel the filesystem is
// read-only except /tmp, so the SQLite data directory must live there too.
if (!process.env.DATA_DIR) process.env.DATA_DIR = '/tmp/arenaplay-data';
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = crypto
    .createHmac('sha256', 'arenaplay-vercel-fallback')
    .update(process.env.VERCEL_PROJECT_ID || process.env.VERCEL_URL || 'localhost')
    .digest('hex');
  console.warn(
    '[vercel-entry] SESSION_SECRET is not set; using a project-derived fallback. ' +
      'Set SESSION_SECRET in the Vercel dashboard so sessions keep a stable signing key.'
  );
}
// Requests always arrive through Vercel's proxy, which sets X-Forwarded-For on
// the client's behalf — trusting it there is what makes per-IP rate limits work.
if (!process.env.TRUST_PROXY) process.env.TRUST_PROXY = 'true';

let booted = null;

/** Boot once per function instance; later requests await the same promise. */
function boot() {
  if (!booted) {
    booted = (async () => {
      const { openDb, get } = await import('../src/db/index.js');
      const { migrate } = await import('../src/db/migrate.js');
      openDb();
      const applied = migrate();
      if (applied.length) console.log(`[vercel-entry] migrations applied: ${applied.join(', ')}`);
      if (!get(`SELECT 1 ok FROM games LIMIT 1`)) {
        console.log('[vercel-entry] empty database detected — seeding demo content');
        const { seed } = await import('../src/db/seed.js');
        await seed();
      }
      const { recoverPendingCasinoBets } = await import('../src/services/bets.js');
      recoverPendingCasinoBets({ olderThanMinutes: 45 });
      const { crashEngine } = await import('../src/services/crash.js');
      const { liveEngine } = await import('../src/services/live.js');
      crashEngine.start();
      liveEngine.reload();
      liveEngine.start();
    })();
  }
  return booted;
}

export default async function entry(req, res) {
  try {
    await boot();
    const { handle } = await import('../src/api/index.js');
    await handle(req, res);
  } catch (err) {
    console.error('[vercel-entry] fatal', err?.stack || err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: { code: 'err.internal' } }));
    } else {
      res.end();
    }
  }
}

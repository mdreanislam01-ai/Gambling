import http from 'node:http';
import config from './config.js';
import { handle } from './api/index.js';
import { openDb, closeDb, run as dbRun } from './db/index.js';
import { migrate } from './db/migrate.js';
import { crashEngine } from './services/crash.js';
import { liveEngine } from './services/live.js';
import { tickFixtures } from './services/sports.js';
import { recoverPendingCasinoBets } from './services/bets.js';
import { logError, audit } from './services/audit.js';

const log = (level, msg, extra = {}) => {
  if (level === 'debug' && config.logLevel !== 'debug') return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : 'log'](line + detail);
};

async function boot() {
  openDb();
  const applied = migrate();
  if (applied.length) log('info', `migrations applied: ${applied.join(', ')}`);

  // First run: fill the DB with realistic demo content so nothing looks broken.
  const { get } = await import('./db/index.js');
  if (!get(`SELECT 1 ok FROM games LIMIT 1`)) {
    log('info', 'empty database detected — seeding demo content');
    const { seed } = await import('./db/seed.js');
    await seed();
  }

  if (config.sports.liveEnabled) {
    const { syncFixtures } = await import('./services/provider.js');
    setInterval(() => syncFixtures().catch((e) => logError({ code: 'sports.sync', message: e.message })), config.sports.refreshS * 1000).unref?.();
    syncFixtures().then((r) => log('info', `sports provider sync: ${JSON.stringify(r)}`)).catch(() => {});
  }

  const recovered = recoverPendingCasinoBets({ olderThanMinutes: 45 });
  if (recovered) log('info', `auto-settled ${recovered} abandoned hand(s)`);

  crashEngine.start();
  liveEngine.reload();
  liveEngine.start();

  const sportsTimer = setInterval(() => {
    try {
      const r = tickFixtures();
      if (r.advanced || r.settled) log('debug', `sports tick`, r);
    } catch (err) {
      logError({ code: 'sports.tick', message: err.message, stack: err.stack });
    }
  }, 15_000);
  sportsTimer.unref?.();

  const housekeeping = setInterval(() => {
    try {
      housekeepingRun();
    } catch (err) {
      logError({ code: 'housekeeping', message: err.message });
    }
  }, 15 * 60_000);
  housekeeping.unref?.();

  const server = http.createServer((req, res) => {
    res.setHeader('Server', 'ArenaPlay');
    handle(req, res).catch((err) => {
      logError({ code: 'http.fatal', message: err?.message || String(err), stack: err?.stack, path: req.url });
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, error: { code: 'err.internal' } }));
      else res.end();
    });
  });
  server.keepAliveTimeout = 30_000;
  server.headersTimeout = 35_000;
  server.requestTimeout = 60_000;

  server.listen(config.port, config.host, () => {
    log('info', `ArenaPlay ${config.env} listening on http://${config.host}:${config.port}`, {
      demoMode: config.demo.mode, db: config.dbFile.replace(`${config.root}/`, ''), node: process.version,
    });
    if (!config.isProd) log('info', 'seeded admin login (change it!): ' + config.admin.seedEmail + ' / ' + config.admin.seedPassword);
  });

  const shutdown = (signal) => {
    log('info', `${signal} received — shutting down`);
    try {
      crashEngine.stop();
      liveEngine.stop();
      server.close();
      audit({ action: 'server.shutdown', entity: 'system' });
    } catch (err) {
      logError({ code: 'shutdown', message: err.message });
    } finally {
      setTimeout(() => { closeDb(); process.exit(0); }, 300).unref?.();
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logError({ code: 'unhandledRejection', message: String(reason?.message || reason), stack: reason?.stack }));
  process.on('uncaughtException', (err) => {
    logError({ code: 'uncaughtException', message: err?.message, stack: err?.stack });
    log('error', `uncaught: ${err?.message}`);
  });

  return server;
}

/** Prune expired sessions + old noise so the DB stays small and privacy-safe. */
export function housekeepingRun() {
  const { run } = requireDb();
  const a = run(`DELETE FROM sessions WHERE expires_at < datetime('now')`).changes;
  const b = run(`DELETE FROM notifications WHERE created_at < datetime('now','-90 days')`).changes;
  const c = run(`DELETE FROM error_logs WHERE resolved = 1 AND last_seen_at < datetime('now','-30 days')`).changes;
  const d = run(`DELETE FROM outbox WHERE created_at < datetime('now','-30 days')`).changes;
  return { sessions: a, notifications: b, errors: c, outbox: d };
}

const requireDb = () => ({ run: dbRun });

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL boot error:', err);
  process.exit(1);
});

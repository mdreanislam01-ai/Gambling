import { get, all } from '../db/index.js';
import fs from 'node:fs';
import config from '../config.js';
import { json } from '../lib/util.js';
import { hub } from './events.js';

const started = Date.now();

/** `-N days` SQLite datetime modifier — built from an integer only. */
const rangeMod = (days) => `-${Math.max(1, Math.min(365, Number(days) || 1))} days`;

export function overview({ days = 7 } = {}) {
  const r = rangeMod(days);
  const bets = get(
    `SELECT COUNT(*) c, COALESCE(SUM(stake),0) wagered, COALESCE(SUM(payout),0) paid,
            COALESCE(SUM(CASE WHEN status IN ('won','cashout') THEN 1 ELSE 0 END),0) wins,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),0) pending
     FROM bets WHERE created_at >= datetime('now', :r)`, { r }
  ) || {};
  const users = get(
    `SELECT COUNT(*) total,
            COALESCE(SUM(CASE WHEN created_at >= datetime('now', :r) THEN 1 ELSE 0 END),0) new_in_range,
            COALESCE(SUM(CASE WHEN last_login_at >= datetime('now', :r) THEN 1 ELSE 0 END),0) active_in_range,
            COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END),0) suspended
     FROM users`, { r }
  ) || {};
  const wagered = Number(bets.wagered || 0);
  const paid = Number(bets.paid || 0);
  return {
    rangeDays: Number(days),
    users: { total: users.total ?? 0, new: users.new_in_range ?? 0, active: users.active_in_range ?? 0, suspended: users.suspended ?? 0 },
    bets: { count: bets.c ?? 0, pending: bets.pending ?? 0, wins: bets.wins ?? 0, winRate: bets.c ? Math.round(((bets.wins ?? 0) / bets.c) * 1000) / 10 : 0 },
    money: {
      wagered, paid, ngr: wagered - paid,
      actualRtpBps: wagered ? Math.round((paid / wagered) * 10000) : 0,
      avgStake: bets.c ? Math.round(wagered / bets.c) : 0,
      currency: config.demo.currency,
    },
    wallet: get(`SELECT COALESCE(SUM(balance),0) total_balance, COALESCE(SUM(lifetime_wagered),0) lifetime_wagered FROM user_wallets`) || {},
    games: get(`SELECT COUNT(*) total, COALESCE(SUM(enabled),0) enabled FROM games`) || {},
    sports: get(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN status='live' THEN 1 ELSE 0 END),0) live, COALESCE(SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END),0) scheduled FROM sports_fixtures`) || {},
    errors: get(`SELECT COUNT(*) unresolved FROM error_logs WHERE resolved = 0`) || {},
    tickets: get(`SELECT COUNT(*) open FROM support_tickets WHERE status IN ('open','in_progress')`) || {},
  };
}

export function dailySeries(days = 14) {
  const rows = all(
    `SELECT day, bets, wagered, paid, wins, users_active FROM daily_stats
     WHERE day >= date('now', :d) ORDER BY day ASC`,
    { d: `-${Math.max(2, Math.min(90, days))} days` }
  );
  const newUsers = all(`SELECT date(created_at) day, COUNT(*) c FROM bets WHERE created_at >= date('now', :d) GROUP BY day`, { d: `-${days} days` });
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    const r = byDay.get(day) || {};
    out.push({ day, bets: r.bets ?? 0, wagered: r.wagered ?? 0, paid: r.paid ?? 0, wins: r.wins ?? 0, ngr: (r.wagered ?? 0) - (r.paid ?? 0) });
  }
  return out;
}

export function gameStats({ days = 30 } = {}) {
  return all(
    `SELECT g.key, g.name, g.engine, g.enabled, g.category, g.plays,
            COUNT(b.id) AS bets, COALESCE(SUM(b.stake),0) AS wagered, COALESCE(SUM(b.payout),0) AS paid,
            COALESCE(SUM(CASE WHEN b.status IN ('won','cashout') THEN 1 ELSE 0 END),0) AS wins,
            COALESCE(MAX(b.multiplier),0) AS best_multiplier
     FROM games g LEFT JOIN bets b ON b.game_key = g.key AND b.created_at >= datetime('now', :r)
     GROUP BY g.key ORDER BY wagered DESC`, { r: rangeMod(days) }
  ).map((r) => ({
    key: r.key, name: r.name, engine: r.engine, category: r.category, enabled: !!r.enabled, plays: r.plays,
    bets: r.bets, wagered: r.wagered, paid: r.paid, ngr: r.wagered - r.paid, wins: r.wins,
    actualRtpBps: r.wagered ? Math.round((r.paid / r.wagered) * 10000) : 0, bestMultiplier: r.best_multiplier,
  }));
}

export function topUsers({ days = 30, limit = 10 } = {}) {
  return all(
    `SELECT u.id, u.username, u.email, COALESCE(SUM(b.stake),0) wagered, COALESCE(SUM(b.payout),0) paid, COUNT(b.id) bets
     FROM users u JOIN bets b ON b.user_id = u.id AND b.created_at >= datetime('now', :r)
     GROUP BY u.id ORDER BY wagered DESC LIMIT :l`, { r: rangeMod(days), l: Math.min(50, Math.max(1, limit)) }
  ).map((r) => ({ ...r, ngr: r.wagered - r.paid }));
}

export function systemStatus() {
  let dbSize = 0;
  try { dbSize = fs.statSync(config.dbFile).size; } catch { /* fresh db */ }
  const mem = process.memoryUsage();
  return {
    uptimeSeconds: Math.floor((Date.now() - started) / 1000),
    nodeVersion: process.version,
    env: config.env,
    demoMode: config.demo.mode,
    memoryMb: { rss: Math.round(mem.rss / 1e6), heap: Math.round(mem.heapUsed / 1e6) },
    database: { file: config.dbFile.replace(config.root + '/', ''), sizeBytes: dbSize, wal: true, migrationsApplied: get(`SELECT COUNT(*) c FROM schema_meta`)?.c ?? 0 },
    sseClients: hub.size,
    engines: { crash: { running: true }, live: { running: true } },
    sportsProvider: config.sports.liveEnabled ? config.sports.provider : 'none (demo data)',
  };
}

// ---------------------------------------------------------------------------
// Report exports (CSV)
// ---------------------------------------------------------------------------
const esc = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(rows, columns) {
  const head = columns.map((c) => esc(c.label ?? c.key)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function report(kind, { days = 30 } = {}) {
  const r = rangeMod(days);
  switch (kind) {
    case 'bets':
      return {
        filename: `bets-${days}d.csv`,
        csv: toCsv(
          all(`SELECT b.*, u.username FROM bets b JOIN users u ON u.id = b.user_id WHERE b.created_at >= datetime('now', :r) ORDER BY b.id DESC LIMIT 5000`, { r }),
          [
            { key: 'public_id', label: 'Bet ID' }, { key: 'username', label: 'User' }, { key: 'kind', label: 'Kind' },
            { key: 'game_key', label: 'Game' }, { key: 'stake', label: 'Stake (cents)' }, { key: 'payout', label: 'Payout (cents)' },
            { key: 'profit', label: 'Profit (cents)' }, { key: 'status', label: 'Status' }, { key: 'multiplier', label: 'Multiplier' },
            { key: 'created_at', label: 'Created' }, { key: 'settled_at', label: 'Settled' },
            { key: 'selection', label: 'Selection JSON', value: (x) => JSON.stringify(json(x.selection, {})) },
          ]
        ),
      };
    case 'transactions':
      return {
        filename: `transactions-${days}d.csv`,
        csv: toCsv(all(`SELECT t.*, u.username FROM transactions t JOIN users u ON u.id = t.user_id WHERE t.created_at >= datetime('now', :r) ORDER BY t.id DESC LIMIT 5000`, { r }),
          [{ key: 'id' }, { key: 'username' }, { key: 'kind' }, { key: 'amount' }, { key: 'balance_after' }, { key: 'reference' }, { key: 'created_at' }]),
      };
    case 'users':
      return {
        filename: `users.csv`,
        csv: toCsv(all(`SELECT u.*, w.balance, w.lifetime_wagered, w.lifetime_won FROM users u LEFT JOIN user_wallets w ON w.user_id = u.id ORDER BY u.id DESC LIMIT 5000`),
          [
            { key: 'id' }, { key: 'email' }, { key: 'username' }, { key: 'role' }, { key: 'status' }, { key: 'locale' },
            { key: 'created_at' }, { key: 'last_login_at' }, { key: 'balance' }, { key: 'lifetime_wagered' }, { key: 'lifetime_won' },
            { key: 'self_exclusion_until' }, { key: 'daily_loss_limit' },
          ]),
      };
    case 'audit':
      return {
        filename: `audit-log.csv`,
        csv: toCsv(all(`SELECT a.*, u.email AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 5000`),
          [{ key: 'id' }, { key: 'created_at' }, { key: 'actor' }, { key: 'actor_role' }, { key: 'action' }, { key: 'entity' }, { key: 'entity_id' }, { key: 'meta' }]),
      };
    default:
      return null;
  }
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';
import { transportable } from '../lib/util.js';

let handle = null;
const stmtCache = new Map();

export function openDb(file = config.dbFile) {
  if (handle) return handle;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
  handle = db;
  return db;
}

export function db() {
  return handle ?? openDb();
}

/** Statement cache — preparing on every call is measurable on hot bet paths. */
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    const st = db().prepare(sql);
    st.__params = new Set([...String(sql).matchAll(/[$:@]([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    s = { st };
    stmtCache.set(sql, s);
  }
  return s.st;
}

/**
 * Normalise bindings. SQLite errors on *unknown* named parameters, so we keep
 * only the names the SQL actually references — that makes it safe to reuse one
 * params object for a page query and its COUNT query.
 */
const bind = (sql, params) => {
  if (params === null || params === undefined) return {};
  if (Array.isArray(params)) return params;
  const st = prep(sql);
  const names = st.__params;
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (names && !names.has(k)) continue;
    out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
  }
  return out;
};

export const run = (sql, params) => {
  const b = bind(sql, params);
  return Array.isArray(b) ? prep(sql).run(...b) : prep(sql).run(b);
};
export const get = (sql, params) => {
  const b = bind(sql, params);
  const r = Array.isArray(b) ? prep(sql).get(...b) : prep(sql).get(b);
  return r ? transportable(r) : null;
};
export const all = (sql, params) => {
  const b = bind(sql, params);
  return (Array.isArray(b) ? prep(sql).all(...b) : prep(sql).all(b)).map(transportable);
};
export const pluck = (sql, params) => {
  const r = get(sql, params);
  return r ? Object.values(r)[0] : null;
};

/** Serialised transaction: SQLite throws if the same statement is reused across threads, so we nest via SAVEPOINT. */
let depth = 0;
export function tx(fn) {
  const d = db();
  if (depth === 0) {
    d.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const out = fn();
      d.exec('COMMIT');
      return out;
    } catch (err) {
      try { d.exec('ROLLBACK'); } catch {}
      throw err;
    } finally {
      depth = 0;
    }
  }
  const sp = `sp_${depth}_${Date.now().toString(36)}`;
  d.exec(`SAVEPOINT ${sp}`);
  depth += 1;
  try {
    const out = fn();
    d.exec(`RELEASE ${sp}`);
    return out;
  } catch (err) {
    d.exec(`ROLLBACK TO ${sp}`);
    d.exec(`RELEASE ${sp}`);
    throw err;
  } finally {
    depth -= 1;
    if (depth < 0) depth = 0;
  }
}

export function closeDb() {
  try { handle?.close(); } catch {}
  handle = null;
  stmtCache.clear();
}

/** Used by tests + `npm run reset`. */
export function dropAll() {
  const rows = all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
  db().exec('PRAGMA foreign_keys = OFF');
  for (const r of rows) db().exec(`DROP TABLE IF EXISTS "${r.name.replace(/"/g, '')}"`);
  db().exec('PRAGMA foreign_keys = ON');
}

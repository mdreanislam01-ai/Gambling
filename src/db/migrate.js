import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, all, get, run } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function listMigrations() {
  const dir = path.join(HERE, 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, version: Number.parseInt(f.split('_')[0], 10), name: f }));
}

export function migrate() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS schema_meta (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(all(`SELECT version FROM schema_meta`).map((r) => r.version));
  const done = [];
  for (const m of listMigrations()) {
    if (applied.has(m.version)) continue;
    const sql = fs.readFileSync(path.join(HERE, 'migrations', m.file), 'utf8');
    d.exec('BEGIN');
    try {
      d.exec(sql);
      run('INSERT INTO schema_meta(version,name) VALUES(:v,:n)', { v: m.version, n: m.name });
      d.exec('COMMIT');
      done.push(m.name);
    } catch (err) {
      d.exec('ROLLBACK');
      throw new Error(`Migration ${m.name} failed: ${err.message}`);
    }
  }
  return done;
}

export function migrationStatus() {
  const applied = new Set(all(`SELECT version FROM schema_meta`).map((r) => r.version));
  return listMigrations().map((m) => ({ ...m, applied: applied.has(m.version) }));
}

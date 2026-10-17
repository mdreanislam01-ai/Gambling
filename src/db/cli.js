#!/usr/bin/env node
import { migrate, migrationStatus } from './migrate.js';
import { openDb, closeDb, dropAll, run } from './index.js';
import config from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

const cmd = process.argv[2] || 'migrate';
openDb();

if (cmd === 'migrate') {
  const done = migrate();
  console.log(done.length ? `applied: ${done.join(', ')}` : 'already up to date');
  console.table(migrationStatus());
} else if (cmd === 'seed') {
  const { seed } = await import('./seed.js');
  const out = await seed();
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'reset') {
  dropAll();
  migrate();
  const { seed } = await import('./seed.js');
  await seed();
  console.log('database reset + seeded');
} else if (cmd === 'backup') {
  const dest = process.argv[3] || path.join(config.dataDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  // A WAL-mode database is not one file: the newest committed transactions are
  // sitting in `-wal`, so copying only the main file would restore an older
  // database and lose bets. Checkpoint first, then copy the consolidated file.
  run(`PRAGMA wal_checkpoint(TRUNCATE)`);
  fs.copyFileSync(config.dbFile, dest);
  const journal = `${config.dbFile}-wal`;
  if (fs.existsSync(journal) && fs.statSync(journal).size > 0) {
    fs.copyFileSync(journal, `${dest}-wal`);
    console.log('note: the write-ahead log still holds data; the copy includes it');
  }
  console.log('backup written to', dest);
} else {
  console.log('usage: node src/db/cli.js [migrate|seed|reset|backup <file>]');
  process.exitCode = 1;
}
closeDb();

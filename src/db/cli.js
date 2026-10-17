#!/usr/bin/env node
import { migrate, migrationStatus } from './migrate.js';
import { openDb, closeDb, dropAll } from './index.js';
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
  fs.copyFileSync(config.dbFile, dest);
  console.log('backup written to', dest);
} else {
  console.log('usage: node src/db/cli.js [migrate|seed|reset|backup <file>]');
  process.exitCode = 1;
}
closeDb();

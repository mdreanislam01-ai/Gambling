/**
 * Boots an isolated ArenaPlay instance for a single test file.
 *
 * Every test process gets its own temp DATA_DIR (set here, before src/config.js
 * is imported — that module freezes its values at load time) so tests never
 * touch ./data/gambling.db and can run in parallel without clobbering each other.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arenaplay-test-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATA_DIR: dir,
  DATABASE_FILE: 'test.db',
  LOG_LEVEL: 'error',
  SESSION_SECRET: 'a'.repeat(48),
  IP_HASH_SALT: 'test-salt-only',
  COOKIE_NAME: 'test_session',
  SEED_ADMIN_EMAIL: 'admin@arenaplay.local',
  SEED_ADMIN_PASSWORD: 'Admin!2026Test',
  SIGNUP_BONUS_CENTS: '500000',
  RESET_DAILY_BONUS: '0',
  RATE_LOGIN_MAX: '50',
  RATE_REGISTER_MAX: '50',
  RATE_BET_MAX: '500',
  RATE_WRITE_MAX: '500',
  RATE_RESET_MAX: '500',
  SPORTS_PROVIDER: 'none',
});

export const tmpDir = dir;

/** Minimal cookie jar + CSRF aware JSON client (mirrors public/js/core/api.js). */
export function makeClient(base) {
  const jar = new Map();
  let csrf = null;
  const readSetCookie = (res) => {
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
  };

  async function send(method, url, body, opts = {}) {
    const headers = { accept: 'application/json', ...(opts.headers || {}) };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && csrf && opts.csrf !== false) headers['x-csrf-token'] = csrf;
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      redirect: 'manual',
    });
    readSetCookie(res);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { ok: false, raw: text }; }
    if (json?.data?.csrf) csrf = json.data.csrf;
    return { status: res.status, headers: res.headers, body: json, ok: json?.ok !== false && res.ok };
  }

  return {
    get csrfToken() { return csrf; },
    cookieHeader: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    jar,
    get: (u, o) => send('GET', u, undefined, o),
    post: (u, b, o) => send('POST', u, b ?? {}, o),
    patch: (u, b, o) => send('PATCH', u, b ?? {}, o),
    del: (u, b, o) => send('DELETE', u, b ?? {}, o),
    raw: (method, u, body, o) => send(method, u, body, o),
  };
}

/** Start migrations + seed + HTTP server; returns a bound client factory. */
export async function bootTestApp({ seed = true, engines = false } = {}) {
  let cleanupEngines = () => {};
  const db = await import('../../src/db/index.js');
  const { migrate } = await import('../../src/db/migrate.js');
  db.openDb();
  migrate();
  if (seed) {
    const { seed: runSeed } = await import('../../src/db/seed.js');
    await runSeed();
  }
  if (engines) {
    const [{ crashEngine }, { liveEngine }] = await Promise.all([
      import('../../src/services/crash.js'), import('../../src/services/live.js'),
    ]);
    crashEngine.start();
    liveEngine.reload();
    liveEngine.start();
    cleanupEngines = () => { try { crashEngine.stop(); liveEngine.stop(); } catch { /* already stopped */ } };
  }
  const { handle } = await import('../../src/api/index.js');
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: { code: 'err.test', params: { message: String(err?.message) } } }));
      else res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    dir,
    db,
    server,
    client: () => makeClient(base),
    /** Registered player + demo admin shortcuts. */
    async player(overrides = {}) {
      const c = makeClient(base);
      const email = `t${Math.random().toString(36).slice(2, 9)}@example.test`;
      const password = overrides.password || 'TestUser!2026';
      const username = overrides.username || email.split('@')[0].replace(/[^a-z0-9_]/gi, '').slice(0, 20) || 'player';
      const res = await c.post('/api/auth/register', {
        email,
        username,
        password,
        confirmAge: true,
        acceptTerms: true,
        locale: overrides.locale || 'en',
        ...overrides.body,
      });
      if (res.status !== 200) throw new Error(`player() registration failed: ${res.status} ${JSON.stringify(res.body)}`);
      c.identity = { email, password, username, userId: res.body.data.user.id };
      return c;
    },
    async admin() {
      const c = makeClient(base);
      const res = await c.post('/api/auth/login', {
        identifier: process.env.SEED_ADMIN_EMAIL,
        password: process.env.SEED_ADMIN_PASSWORD,
      });
      if (res.status !== 200) throw new Error(`admin() login failed: ${res.status} ${JSON.stringify(res.body)}`);
      return c;
    },
    async close() {
      cleanupEngines();
      // Long-lived SSE streams would keep server.close() waiting forever.
      try {
        const { hub } = await import('../../src/services/events.js');
        hub.closeAll();
      } catch { /* module not loaded */ }
      await Promise.race([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]).catch(() => {});
      db.closeDb();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

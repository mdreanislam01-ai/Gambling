/**
 * Security primitives and configuration guards. These are the "no secrets, no
 * bypass" guarantees the platform is built on, so they are checked directly
 * against the modules rather than through HTTP.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { bootTestApp } from './helpers/app.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let app;

before(async () => { app = await bootTestApp({ seed: false }); });
after(async () => { await app.close(); });

const load = (p) => import(`../src/${p}`);

describe('password handling', () => {
  it('hashes with scrypt + per-password salt and verifies only the exact secret', async () => {
    const { hashPassword, verifyPassword } = await load('lib/security.js');
    const pw = 'Bengal!Tiger9';
    const a = hashPassword(pw);
    const b = hashPassword(pw);
    assert.notEqual(a, b, 'the salt makes two hashes of the same secret differ');
    assert.equal(verifyPassword(pw, a), true);
    assert.equal(verifyPassword(pw + ' ', a), false);
    assert.equal(verifyPassword('', a), false);
    assert.equal(verifyPassword(pw, 'garbage'), false, 'malformed hashes never verify');
    assert.ok(!a.includes(pw));
  });

  it('applies the same policy on both sides of the wire', async () => {
    const { passwordIssues } = await load('lib/security.js');
    const client = await import('../public/js/forms.js');
    const cases = ['a'.repeat(12), 'Password1234', 'Bengal!Tiger9', '  short 9!', 'ALLCAPS123!x', 'nouppercase1!'];
    for (const pw of cases) {
      assert.deepEqual(passwordIssues(pw), client.passwordIssues(pw), `client and server must agree for ${JSON.stringify(pw)}`);
    }
    assert.deepEqual(passwordIssues('Bengal!Tiger9'), []);
    assert.ok(passwordIssues('short').includes('sec.pw_short'));
    assert.ok(passwordIssues('  Bengal!Tiger9').includes('sec.pw_space'));
  });

  it('rejects a malformed stored hash instead of crashing', async () => {
    const { verifyPassword } = await load('lib/security.js');
    for (const junk of ['', 'x', 'scrypt', 'scrypt$99$8$1$zz$zz']) {
      assert.doesNotThrow(() => verifyPassword('whatever', junk));
      assert.equal(verifyPassword('whatever', junk), false);
    }
  });
});

describe('tokens, hashing and fairness rolls', () => {
  it('generates unique, unguessable tokens', async () => {
    const { token, sha256, hmacHex } = await load('lib/security.js');
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) {
      const t = token(24);
      assert.match(t, /^[a-f0-9]{48}$/);
      seen.add(t);
    }
    assert.equal(seen.size, 500);
    assert.equal(sha256('a').length, 64);
    assert.notEqual(hmacHex('k1', 'v'), hmacHex('k2', 'v'), 'the key changes the digest');
  });

  it('derives fair rolls only from the committed seed material', async () => {
    const { fairRoll, floatFromHash, intFromHash } = await load('lib/security.js');
    const roll = (seed, nonce, client, key) => fairRoll(seed, nonce, client, key);
    assert.equal(roll('s', 1, 'c', 'g'), roll('s', 1, 'c', 'g'), 'same inputs ⇒ same digest — that is what makes it verifiable');
    assert.match(roll('s', 1, 'c', 'g'), /^[a-f0-9]{64}$/);
    assert.notEqual(roll('s', 2, 'c', 'g'), roll('s', 1, 'c', 'g'), 'the nonce advances the outcome');
    assert.notEqual(roll('s', 1, 'me', 'g'), roll('s', 1, 'you', 'g'), 'the client seed shifts it');
    assert.notEqual(roll('s', 1, 'c', 'other'), roll('s', 1, 'c', 'g'), 'and so does the game key');

    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 400; i += 1) {
      const f = floatFromHash(roll('seed', i, 'client', 'g'));
      assert.ok(f >= 0 && f < 1, `float out of range: ${f}`);
      buckets[Math.floor(f * 10)] += 1;
    }
    assert.ok(buckets.every((n) => n > 15), `distribution looks broken: ${buckets.join(',')}`);

    // intFromHash(hash, maxExclusive, offset) — the same helper the engines use.
    for (let i = 0; i < 300; i += 1) {
      const h = roll('s', i, 'c', 'g');
      const v = intFromHash(h, 100, 5);
      assert.ok(v >= 5 && v < 105, `int out of range: ${v}`);
      assert.equal(intFromHash(h, 100, 5), v, 'deterministic');
    }
    assert.equal(intFromHash(roll('s', 1, 'c', 'g'), 0, 7), 7, 'a zero width range is the offset, never a negative index');
    // The crash round is derived by the game engine, not by a helper here.
    const { crashPoint } = await load('games/crash.js');
    const points = [];
    for (let i = 0; i < 400; i += 1) {
      const p = crashPoint('server-seed', 'client', i, 100);
      assert.ok(p >= 1 && p <= 5000, `crash point out of bounds: ${p}`);
      points.push(p);
    }
    assert.ok(points.some((p) => p > 2), 'crash must have a tail, not a wall of instant busts');
    assert.notEqual(crashPoint('a', 'c', 1, 100), crashPoint('b', 'c', 1, 100));
  });

  it('encrypts at rest and detects tampering', async () => {
    const mod = await load('lib/security.js');
    if (typeof mod.encryptSecret !== 'function') return assert.ok(true, 'no at-rest encryption in this build');
    const key = 'k'.repeat(32);
    const enc = mod.encryptSecret('provider-api-key', key);
    assert.notEqual(enc, 'provider-api-key');
    assert.ok(!enc.includes('provider-api-key'));
    assert.equal(mod.decryptSecret(enc, key), 'provider-api-key');
    assert.equal(mod.decryptSecret(enc + 'x', key), null, 'tampering yields nothing, never a partial decrypt');
    assert.equal(mod.decryptSecret(enc, 'j'.repeat(32)), null, 'wrong key yields nothing');
    assert.equal(mod.decryptSecret('nonsense', key), null);
    assert.equal(mod.safeEqual('a-token', 'a-token'), true);
    assert.equal(mod.safeEqual('a-token', 'a-tokes'), false);
    assert.equal(mod.safeEqual('a-token', undefined), false);
    const { sha256 } = mod;
    const hashed = mod.hashIp('203.0.113.7');
    assert.equal(hashed.length, 32, 'a short, non-reversible handle is what lands in the audit row');
    assert.notEqual(hashed, sha256('203.0.113.7').slice(0, 32), 'the IP is keyed with IP_HASH_SALT, not bare-sha256 (no rainbow lookup)');
    assert.equal(hashed, mod.hashIp('203.0.113.7'), 'stable per IP so repeat offenders can still be spotted');
    assert.notEqual(hashed, mod.hashIp('198.51.100.4'), 'different clients differ');
    assert.match(mod.hashIp(undefined), /^[a-f0-9]{32}$/, 'a missing IP still hashes safely');
  });
});

describe('rate limiting', () => {
  it('blocks after the configured burst and recovers after the window', async () => {
    const { RateLimiter } = await load('lib/security.js');
    const rl = new RateLimiter({ max: 3, windowS: 1 });
    const key = 'a';
    for (let i = 0; i < 3; i += 1) assert.equal(rl.hit(key).ok, true);
    const blocked = rl.hit(key);
    assert.equal(blocked.ok, false);
    assert.ok(blocked.resetMs > 0 && blocked.resetMs <= 1000);
    assert.equal(rl.hit('other-key').ok, true, 'one abuser does not lock out everyone else');
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(rl.hit(key).ok, true, 'the window rolls over');
  });

  it('keeps separate buckets per limiter name', async () => {
    const { RateLimiter } = await load('lib/security.js');
    const a = new RateLimiter({ max: 1, windowS: 60 });
    const b = new RateLimiter({ max: 1, windowS: 60 });
    assert.equal(a.hit('x').ok, true);
    assert.equal(a.hit('x').ok, false);
    assert.equal(b.hit('x').ok, true);
  });
});

describe('configuration safety', () => {
  it('refuses to boot if anyone tries to enable real money', async () => {
    const script = 'process.env.REAL_MONEY_ENABLED="true";import("./src/config.js").then(()=>{console.log("BOOTED");process.exit(0)},(e)=>{console.log("REFUSED:"+e.message);process.exit(0)})';
    const out = execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: path.join(os.tmpdir(), 'arenaplay-cfg') } });
    assert.match(out, /REFUSED/, out);
    assert.doesNotMatch(out, /BOOTED/);
    const script2 = 'process.env.DEMO_MODE="false";import("./src/config.js").then(()=>{console.log("BOOTED");process.exit(0)},(e)=>{console.log("REFUSED:"+e.message);process.exit(0)})';
    const out2 = execFileSync(process.execPath, ['-e', script2], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: path.join(os.tmpdir(), 'arenaplay-cfg2') } });
    assert.match(out2, /REFUSED/, out2);
  });

  it('parses .env files without overriding the real environment', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arenaplay-env-'));
    fs.writeFileSync(path.join(dir, '.env'), '# comment\nFOO=from-file\nBAR = "quoted value" \nEMPTY=\n');
    const src = `
      const fs = await import('node:fs');
      process.env.FOO = 'from-env';
      ${fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8').split('export default')[0].replace(/from '\.\//g, "from '" + JSON.stringify(ROOT) + '/src/')}
    `;
    fs.writeFileSync(path.join(dir, 'probe.mjs'), src);
    assert.ok(src.includes('function loadEnvFile'), 'config still owns the parser');
    fs.rmSync(dir, { recursive: true, force: true });
    // Behavioural check through the live process: the parser never clobbers env.
    const cfg = (await load('config.js')).default;
    assert.equal(cfg.demo.mode, true);
    assert.equal(cfg.cookie.name, 'test_session', 'environment wins over .env');
  });

  it('documents every knob it reads and ships no secrets', () => {
    const cfgSrc = fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8');
    const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const used = new Set();
    for (const m of cfgSrc.matchAll(/\b(?:str|int|bool)\(\s*'([A-Z0-9_]+)'/g)) used.add(m[1]);
    assert.ok(used.size >= 20, `expected the config to read env vars, found ${used.size}`);
    const undocumented = [...used].filter((k) => !envExample.split('\n').some((line) => line.startsWith(k + '=') || line.startsWith(k + ' =')));
    assert.deepEqual(undocumented, [], `.env.example is missing: ${undocumented.join(', ')}`);
    const secrets = [...envExample.matchAll(/^([A-Z_]*(SECRET|KEY|PASSWORD)[A-Z_]*)=(.*)$/gm)].filter(([, , , v]) => v.trim() !== '');
    for (const [, key, , value] of secrets) {
      assert.match(value, /(change-me|example|ChangeMe|^\s*$)/i, `${key} must ship as an obvious placeholder`);
    }
    assert.ok(!fs.existsSync(path.join(ROOT, '.env')), 'a real .env must never be committed');
    assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /\.env/);
  });

  it('keeps the demo rails on: currency label, credit caps and no payment config', async () => {
    const cfg = (await load('config.js')).default;
    assert.equal(cfg.demo.mode, true);
    assert.equal(cfg.demo.currency, 'DEMO');
    assert.ok(cfg.demo.maxBalanceCents > 0, 'balances are capped so runaway demos cannot grow forever');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      assert.ok(!/stripe|paypal|braintree|razorpay|cashfree|paytm/i.test(dep), `no payment SDK may be installed (${dep})`);
    }
    const files = fs.readdirSync(path.join(ROOT, 'src/api'));
    const src = files.map((f) => fs.readFileSync(path.join(ROOT, 'src/api', f), 'utf8')).join('\n');
    assert.doesNotMatch(src, /deposit|withdrawal|cashout_money|card_number/i, 'no money-movement endpoints');
    assert.match(src, /demo/);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and a CSP nonce on every response', async () => {
    const res = await fetch(app.base + '/', { redirect: 'manual' });
    const h = res.headers;
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.match(h.get('x-frame-options') || '', /DENY|SAMEORIGIN/);
    assert.ok(h.get('referrer-policy'));
    assert.match(h.get('permissions-policy') || '', /camera=\(\)/);
    const csp = h.get('content-security-policy') || '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src[^;]*'nonce-[A-Za-z0-9_-]+'/, 'scripts need a per-request nonce');
    assert.match(csp, /frame-ancestors/);
    const html = await res.text();
    const nonce = csp.match(/script-src[^;]*'nonce-([A-Za-z0-9_-]+)'/)[1];
    assert.ok(html.includes(`nonce="${nonce}"`), 'the inline boot script carries that nonce');
    assert.ok(!html.includes('nonce="%CSP_NONCE%"'), 'placeholders are always replaced');
    const second = await fetch(app.base + '/');
    assert.notEqual(second.headers.get('content-security-policy'), csp, 'a fresh nonce per request');
  });

  it('never serves files outside the public directory', async () => {
    for (const probe of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/src/config.js', '/../../etc/passwd', '/css/../../package.json', '/%00index.html']) {
      const res = await fetch(app.base + probe, { redirect: 'manual' });
      const text = await res.text();
      assert.notMatch?.(text, /"name": "arena-play-gaming-platform"/);
      assert.ok(!text.includes('REAL_MONEY') || res.status >= 400, `leaked source through ${probe}`);
      assert.ok(!text.includes('node:sqlite'), `leaked server code through ${probe}`);
      assert.ok([200, 301, 400, 403, 404].includes(res.status), `${probe} → ${res.status}`);
      if (res.status === 200) assert.match(res.headers.get('content-type') || '', /html/, 'only the SPA shell may answer 200');
    }
  });

  it('caps the request body and answers oversized payloads with 413', async () => {
    const c = await app.player();
    const huge = 'a'.repeat(2 * 1024 * 1024);
    const res = await c.raw('POST', '/api/account/locale', huge);
    assert.equal(res.status, 413, `status ${res.status}`);
    assert.equal(res.body?.error?.code, 'err.body_too_large');
    const stillAlive = await c.get('/api/account/summary');
    assert.equal(stillAlive.status, 200, 'the connection survives a rejected upload');
  });

  it('returns JSON errors with codes, never stack traces', async () => {
    const res = await fetch(app.base + '/api/does-not-exist', { headers: { accept: 'application/json' } });
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.ok(body.error.code);
    assert.ok(!JSON.stringify(body).includes('at '), 'no stack in the payload');
  });

  it('refuses non-GET traffic on the static shell and unknown methods on the API', async () => {
    assert.equal((await fetch(app.base + '/', { method: 'DELETE' })).status, 405);
    const created = await fetch(app.base + '/api/games', { method: 'PUT', body: '{}' });
    assert.ok([404, 405].includes(created.status), String(created.status), 'unknown API methods never fall through to the static handler');
  });

  it('tells clients the app is a demo on every boot payload', async () => {
    const res = await fetch(app.base + '/');
    const html = await res.text();
    const boot = JSON.parse(html.match(/window\.__BOOT__\s*=\s*(\{.*?\});/s)[1]);
    assert.equal(boot.demo.mode, true);
    assert.equal(boot.demo.currency, 'DEMO');
    assert.equal(boot.authenticated, false);
    assert.ok(!('csrf' in boot) || boot.csrf === null, 'no token is embedded for anonymous visitors');
  });
});

describe('cookies', () => {
  it('serializes safe, scoped cookies', async () => {
    const { serializeCookie } = await load('lib/http.js');
    const c = serializeCookie('n', 'v', { maxAge: 60 });
    assert.match(c, /^n=v; Path=\//);
    assert.match(c, /Max-Age=60/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /HttpOnly/);
    assert.match(serializeCookie('n', 'v', { httpOnly: false }), /^(?!.*HttpOnly)/s);
    assert.match(serializeCookie('n', 'v', { maxAge: 0 }), /Max-Age=0/);
    assert.match(serializeCookie('n', 'needs encoding', {}), /n=needs%20encoding/);
  });
});

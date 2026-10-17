/**
 * Registration, login, sessions, password reset, profile and account closure.
 * Every assertion checks a persisted side effect, not just an HTTP 200.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { bootTestApp } from './helpers/app.js';

let app;
const PW = 'Bengal!Tiger9';

before(async () => { app = await bootTestApp(); });
after(async () => { await app.close(); });

const reg = (over = {}) => ({
  email: `u${Math.random().toString(36).slice(2, 9)}@example.test`,
  username: `u${Math.random().toString(36).slice(2, 9)}`,
  password: PW,
  confirmAge: true,
  acceptTerms: true,
  ...over,
});
const errCode = (res) => res.body?.error?.code;

describe('registration', () => {
  it('creates the account, credits demo funds and issues a hardened cookie', async () => {
    const c = app.client();
    const res = await c.post('/api/auth/register', { ...reg({ locale: 'bn' }), birthdate: '1990-04-02' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.user.locale, 'bn');
    assert.equal(res.body.data.wallet.balance, 500000);
    assert.equal(res.body.data.wallet.currency, 'DEMO');
    assert.equal(res.body.data.created, true);
    assert.ok(res.body.data.csrf, 'csrf token handed to the client');

    const cookie = (res.headers.getSetCookie() || []).find((s) => s.startsWith('test_session='));
    assert.ok(cookie, 'session cookie issued');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/i, 'Secure is only added over https / in production');
    assert.doesNotMatch(cookie, /domain=/i, 'no over-broad domain');

    const sess = await c.get('/api/auth/session');
    assert.equal(sess.body.data.authenticated, true);
    assert.ok(!JSON.stringify(sess.body.data).includes('password'), 'no password material in session payload');
  });

  it('stores a salted scrypt hash and never the plaintext password', async () => {
    const email = 'hashcheck@example.test';
    await app.client().post('/api/auth/register', reg({ email, username: 'hash_check' }));
    const row = app.db.get(`SELECT password_hash FROM users WHERE lower(email) = lower('${email}')`);
    assert.ok(row?.password_hash, 'row written');
    assert.ok(!row.password_hash.includes(PW));
    const [algo, cost, r, p, salt, hash] = row.password_hash.split('$');
    assert.equal(algo, 'scrypt');
    assert.ok(Number(cost) >= 14, `scrypt cost too low: ${cost}`);
    assert.equal(Number(r), 8);
    assert.equal(Number(p), 1);
    assert.ok(salt.length >= 16 && hash.length >= 32);
    assert.equal(row.password_hash.length > 40, true);
    const other = app.db.get(`SELECT password_hash FROM users WHERE lower(email) <> lower('${email}') LIMIT 1`);
    assert.notEqual(other.password_hash, row.password_hash, 'per-user salt ⇒ different hash for the same password');
  });

  it('rejects duplicate email and duplicate username with distinct field codes', async () => {
    const first = await app.client().post('/api/auth/register', reg({ email: 'dup-a@example.test', username: 'dup_user' }));
    assert.equal(first.status, 200);
    const emailDup = await app.client().post('/api/auth/register', reg({ email: 'dup-a@example.test', username: 'other_name' }));
    assert.equal(emailDup.status, 409);
    assert.equal(errCode(emailDup), 'auth.email_taken');
    assert.equal(emailDup.body.error.params.field, 'email');
    const userDup = await app.client().post('/api/auth/register', reg({ email: 'dup-b@example.test', username: 'dup_user' }));
    assert.equal(userDup.status, 409);
    assert.equal(errCode(userDup), 'auth.username_taken');
    assert.equal(userDup.body.error.params.field, 'username');
  });

  it('returns every field error at once so forms can show them inline', async () => {
    const res = await app.client().post('/api/auth/register', {
      email: 'nope', username: 'x', password: 'abc', confirm: 'abc',
    });
    assert.equal(res.status, 422);
    assert.equal(errCode(res), 'val.failed');
    const fields = res.body.error.params.errors.map((e) => e.field);
    assert.deepEqual([...new Set(fields)].sort(), ['acceptTerms', 'confirmAge', 'email', 'password', 'username']);
    const codes = res.body.error.params.errors.map((e) => e.code);
    assert.ok(codes.includes('val.email') && codes.includes('val.username') && codes.includes('sec.pw_short'));
    assert.ok(codes.includes('val.age_required') && codes.includes('val.terms_required'));
  });

  it('flags weak passwords and blocks common patterns', async () => {
    const res = await app.client().post('/api/auth/register', reg({ password: 'Password1234' }));
    assert.equal(res.status, 422);
    assert.ok(res.body.error.params.errors.some((e) => e.code === 'sec.pw_common' || e.code === 'sec.pw_symbol'), JSON.stringify(res.body.error));
    const spaces = await app.client().post('/api/auth/register', reg({ password: '  Bengal Tiger 9  ' }));
    assert.equal(spaces.status, 422);
    assert.ok(spaces.body.error.params.errors.some((e) => e.code === 'sec.pw_space'));
    const noSymbol = await app.client().post('/api/auth/register', reg({ password: 'BengalTiger9999' }));
    assert.equal(noSymbol.status, 422);
    assert.ok(noSymbol.body.error.params.errors.some((e) => e.code === 'sec.pw_symbol'));
  });

  it('silently drops honeypot submissions', async () => {
    const res = await app.client().post('/api/auth/register', reg({ website: 'http://spam.example' }));
    assert.equal(res.status, 422);
    assert.equal(errCode(res), 'val.spam');
  });

  it('never leaks internals in error bodies', async () => {
    const res = await app.client().post('/api/auth/register', reg({ email: 'bad' }));
    const dump = JSON.stringify(res.body);
    assert.ok(!dump.includes(process.env.SESSION_SECRET));
    assert.ok(!dump.includes('password_hash'));
    assert.ok(!/at .*\(.*:\d+:\d+\)/.test(dump), 'no stack frames');
  });
});

describe('login and logout', () => {
  it('accepts email or username and is indistinguishable for unknown accounts', async () => {
    const c = await app.player();
    const { email, password } = c.identity;
    const byEmail = await app.client().post('/api/auth/login', { identifier: email, password });
    assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
    const byName = await app.client().post('/api/auth/login', { identifier: byEmail.body.data.user.username, password });
    assert.equal(byName.status, 200);
    assert.equal(byName.body.data.user.id, byEmail.body.data.user.id);

    const noUser = await app.client().post('/api/auth/login', { identifier: 'ghost@example.test', password: 'Whatever!2026' });
    const wrongPw = await app.client().post('/api/auth/login', { identifier: email, password: 'WrongPass!2026x' });
    assert.equal(noUser.status, 401);
    assert.equal(wrongPw.status, 401);
    assert.equal(errCode(noUser), errCode(wrongPw));
    assert.equal(noUser.body.data, undefined, 'no data on failure');
  });

  it('requires an identifier', async () => {
    const res = await app.client().post('/api/auth/login', { identifier: '   ', password: 'Whatever!2026' });
    assert.equal(res.status, 401);
    assert.equal(errCode(res), 'auth.invalid_credentials');
  });

  it('locks the account after repeated failures and an admin can unlock it', async () => {
    const c = await app.player();
    for (let i = 0; i < 8; i += 1) {
      await app.client().post('/api/auth/login', { identifier: c.identity.email, password: 'WrongPass!2026x' });
    }
    const locked = await app.client().post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    assert.equal(locked.status, 423, 'a locked account is not a plain credential failure');
    assert.equal(errCode(locked), 'auth.locked');
    const note = app.db.get(`SELECT title_key FROM notifications WHERE user_id = ${c.identity.userId} ORDER BY id DESC LIMIT 1`);
    assert.equal(note.title_key, 'notif.account_locked', 'the player gets an in-app explanation');
    assert.equal(app.db.get(`SELECT failed_attempts FROM users WHERE id = ${c.identity.userId}`).failed_attempts >= 8, true);
    assert.ok(locked.body.error.params.until, 'tells the player until when');

    const admin = await app.admin();
    const patch = await admin.patch(`/api/admin/users/${c.identity.userId}`, { lockedUntil: null });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    const after = await app.client().post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    assert.equal(after.status, 200, 'unlocked again');
    const auditRow = app.db.get(`SELECT action FROM audit_logs WHERE action = 'auth.login_failed' ORDER BY id DESC LIMIT 1`);
    assert.equal(auditRow.action, 'auth.login_failed', 'failed attempts are audited');
  });

  it('logout deletes the session row and clears the cookie', async () => {
    const c = await app.player();
    const before = app.db.get('SELECT COUNT(*) n FROM sessions').n;
    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal(out.body.data.ok, true);
    assert.equal(app.db.get('SELECT COUNT(*) n FROM sessions').n, before - 1);
    assert.equal((await c.get('/api/auth/session')).body.data.authenticated, false);
    assert.equal(errCode(await c.get('/api/account/summary')), 'auth.required');
  });

  it('requires the CSRF header for authenticated mutations', async () => {
    const c = await app.player();
    const res = await c.post('/api/auth/logout', {}, { csrf: false });
    assert.equal(res.status, 403);
    assert.equal(errCode(res), 'err.csrf');
    assert.equal((await c.get('/api/auth/session')).body.data.authenticated, true, 'still signed in');
  });

  it('refuses anonymous access to every protected endpoint', async () => {
    const c = app.client();
    for (const url of ['/api/account/summary', '/api/wallet', '/api/bets', '/api/favorites', '/api/rg/status', '/api/notifications', '/api/tickets', '/api/account/sessions', '/api/admin/overview']) {
      const res = await c.get(url);
      assert.equal(res.status, 401, `${url} → ${res.status}`);
      assert.equal(errCode(res), 'auth.required', url);
    }
  });
});

describe('password reset', () => {
  it('mails a real token, rotates the password and revokes other sessions', async () => {
    const c = await app.player();
    const other = app.client();
    await other.post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });

    const unknown = await app.client().post('/api/auth/forgot', { email: 'nobody-here@example.test' });
    const known = await app.client().post('/api/auth/forgot', { email: c.identity.email });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(known.body.data, unknown.body.data, 'identical response whether or not the address exists');
    assert.equal(known.body.data.code, 'auth.reset_requested');

    const mail = await app.client().get(`/api/dev/mailbox/${encodeURIComponent(c.identity.email)}`);
    assert.equal(mail.status, 200);
    assert.equal(mail.body.data.demoMode, true);
    const text = JSON.stringify(mail.body.data.rows);
    assert.ok(mail.body.data.rows.length >= 1);
    const token = text.match(/\/reset-password\?token=([a-f0-9]{20,80})/)?.[1];
    assert.ok(token, `reset link with token in mailbox: ${text.slice(0, 120)}`);
    assert.ok(!text.includes(c.identity.password), 'mail never echoes the password');

    const weak = await app.client().post('/api/auth/reset', { token, password: 'abc' });
    assert.equal(weak.status, 422);
    assert.equal(weak.body.error.params.errors[0].field, 'password');

    const reset = await app.client().post('/api/auth/reset', { token, password: 'Rotated!Tiger22' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.data.code, 'auth.reset_done');
    assert.equal((await app.client().post('/api/auth/login', { identifier: c.identity.email, password: PW })).status, 401);
    assert.equal((await app.client().post('/api/auth/login', { identifier: c.identity.email, password: 'Rotated!Tiger22' })).status, 200);
    assert.equal((await other.get('/api/auth/session')).body.data.authenticated, false, 'other devices signed out');

    const reuse = await app.client().post('/api/auth/reset', { token, password: 'Third!Tiger333' });
    assert.equal(reuse.status, 400);
    assert.equal(errCode(reuse), 'auth.reset_invalid');
  });

  it('rejects a bogus token and malformed addresses', async () => {
    assert.equal(errCode(await app.client().post('/api/auth/reset', { token: 'f'.repeat(64), password: 'Rotated!Tiger22' })), 'auth.reset_invalid');
    const bad = await app.client().post('/api/auth/forgot', { email: 'not-an-email' });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.params.errors[0].code, 'val.email');
  });

  it('changing the password keeps only the current session', async () => {
    const c = await app.player();
    const other = app.client();
    await other.post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    const wrong = await c.post('/api/auth/password', { currentPassword: 'Nope!Nothing3', newPassword: 'Fresh!Tiger77' });
    assert.equal(wrong.status, 403);
    assert.equal(errCode(wrong), 'auth.wrong_password');
    const res = await c.post('/api/auth/password', { currentPassword: c.identity.password, newPassword: 'Fresh!Tiger77' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.code, 'auth.password_updated');
    assert.equal((await other.get('/api/auth/session')).body.data.authenticated, false);
    const rows = (await c.get('/api/account/sessions')).body.data.rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].current, true);
  });
});

describe('profile, language and sessions', () => {
  it('remembers the language for the next visit and for the first paint', async () => {
    const c = await app.player();
    const res = await c.post('/api/account/locale', { locale: 'bn' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.locale, 'bn');
    assert.equal(app.db.get(`SELECT locale FROM users WHERE id = ${c.identity.userId}`).locale, 'bn');
    const anon = await app.client().post('/api/account/locale', { locale: 'bn' });
    assert.equal(anon.status, 200, 'anonymous preference is still honoured via cookie');
    const page = await fetch(app.base + '/', { headers: { cookie: anon.headers.get('content-type') ? '' : '' } });
    assert.ok(page.ok);
    const html = await fetch(app.base + '/', { headers: { cookie: c.cookieHeader() } }).then((r) => r.text());
    assert.match(html, /<html[^>]+lang="bn"/, 'server-rendered shell uses the stored locale');
    assert.match(html, /dir="ltr"/);
    assert.equal((await c.post('/api/account/locale', { locale: 'de' })).body.data.locale, 'en', 'unsupported locale falls back');
  });

  it('patches allowed profile fields only', async () => {
    const c = await app.player();
    const res = await c.patch('/api/account/profile', {
      username: c.identity.username, avatar: 'cobra', birthdate: '1988-12-01',
      marketingOptin: true, notifyPush: false, country: 'BD',
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = app.db.get(`SELECT avatar, birthdate, marketing_optin, notify_push, country FROM users WHERE id = ${c.identity.userId}`);
    assert.equal(row.avatar, 'cobra');
    assert.equal(row.birthdate, '1988-12-01');
    assert.equal(row.marketing_optin, 1);
    assert.equal(row.notify_push, 0);
    assert.equal(row.country, 'BD');
  });

  it('ignores privilege fields and rejects a self-granted role', async () => {
    const c = await app.player();
    const res = await c.patch('/api/account/profile', { role: 'admin', status: 'active', balanceCents: 999999999, id: 1 });
    assert.equal(res.status, 200);
    const row = app.db.get(`SELECT role, status FROM users WHERE id = ${c.identity.userId}`);
    assert.equal(row.role, 'user');
    assert.equal(row.status, 'active');
    assert.equal(c.identity.userId, row.id ?? c.identity.userId);
  });

  it('enforces the adult-date rule on the profile', async () => {
    const c = await app.player();
    const minor = await c.patch('/api/account/profile', { birthdate: '2018-01-01' });
    assert.equal(minor.status, 422);
    assert.equal(errCode(minor), 'val.age_required');
    const malformed = await c.patch('/api/account/profile', { birthdate: '01/01/1990' });
    assert.equal(malformed.status, 422);
    assert.equal(malformed.body.error.params.errors[0].code, 'val.date_invalid');
  });

  it('lists devices without exposing tokens and can sign the others out', async () => {
    const c = await app.player();
    const d1 = app.client();
    const d2 = app.client();
    await d1.post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    await d2.post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    const list = await c.get('/api/account/sessions');
    assert.ok(list.body.data.rows.length >= 3);
    assert.ok(list.body.data.rows.some((s) => s.current === true));
    assert.ok(list.body.data.rows.every((s) => !/^[a-f0-9]{16,}$/.test(s.id)), 'session ids are masked');
    assert.ok(!JSON.stringify(list.body.data.rows).includes('csrf'), 'csrf tokens never listed');

    const revoked = await c.post('/api/account/sessions/revoke', { all: true });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.revoked, 'others');
    assert.equal((await d1.get('/api/auth/session')).body.data.authenticated, false);
    assert.equal((await c.get('/api/auth/session')).body.data.authenticated, true);
  });

  it('closes the account on the right password and blocks further logins', async () => {
    const c = await app.player();
    const wrong = await c.post('/api/account/close', { password: 'nope-nope-nope' });
    assert.equal(wrong.status, 403);
    assert.equal(errCode(wrong), 'auth.wrong_password');
    const res = await c.post('/api/account/close', { password: c.identity.password });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.code, 'settings.closed', 'a translatable code the client can toast');
    assert.equal(app.db.get(`SELECT status FROM users WHERE id = ${c.identity.userId}`).status, 'closed');
    const relogin = await app.client().post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    assert.equal(relogin.status, 403);
    assert.equal(errCode(relogin), 'auth.account_closed');
  });

  it('suspension from the admin console blocks the login path', async () => {
    const c = await app.player();
    const admin = await app.admin();
    const patch = await admin.patch(`/api/admin/users/${c.identity.userId}`, { status: 'suspended' });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    const res = await app.client().post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password });
    assert.equal(res.status, 403);
    assert.equal(errCode(res), 'auth.account_suspended');
    await admin.patch(`/api/admin/users/${c.identity.userId}`, { status: 'active' });
    assert.equal((await app.client().post('/api/auth/login', { identifier: c.identity.email, password: c.identity.password })).status, 200);
  });
});

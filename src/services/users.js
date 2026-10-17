import crypto from 'node:crypto';
import { get, run, all, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import config from '../config.js';
import { hashPassword, verifyPassword, passwordIssues, token, sha256, shortCode } from '../lib/security.js';
import { emailOk, usernameOk, json, clamp, daysFromNow } from '../lib/util.js';
import * as wallet from './wallet.js';
import { audit, sendMail } from './audit.js';
import { notifyUser } from './notify.js';
import { registrationOpen } from './settings.js';

export const AVATARS = ['tiger', 'lion', 'eagle', 'cobra', 'royal', 'flame', 'moon', 'star', 'bolt', 'shield'];

const publicUser = (u) =>
  u && {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    status: u.status,
    locale: u.locale,
    avatar: u.avatar || 'star',
    phone: u.phone || '',
    country: u.country || '',
    birthdate: u.birthdate || '',
    marketingOptin: !!u.marketing_optin,
    emailVerified: !!u.email_verified,
    limits: {
      dailyLoss: u.daily_loss_limit ?? null,
      weeklyWager: u.weekly_wager_limit ?? null,
      sessionMinutes: u.session_limit_min ?? null,
      realityCheck: !!u.reality_check,
    },
    selfExclusionUntil: u.self_exclusion_until,
    lockedUntil: u.locked_until,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    notifyEmail: !!u.notify_email,
    notifyPush: !!u.notify_push,
  };

export { publicUser };

export function findByEmailOrUsername(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  return get(`SELECT * FROM users WHERE lower(email) = lower(:i) OR lower(username) = lower(:i) LIMIT 1`, { i: id });
}

export function register({ email, username, password, locale, confirmAge, acceptTerms, referral, ip }) {
  const e = String(email || '').trim().toLowerCase();
  const u = String(username || '').trim();
  const errors = [];
  if (!emailOk(e)) errors.push({ field: 'email', code: 'val.email' });
  if (!usernameOk(u)) errors.push({ field: 'username', code: 'val.username' });
  for (const code of passwordIssues(password)) errors.push({ field: 'password', code });
  if (!confirmAge) errors.push({ field: 'confirmAge', code: 'val.age_required' });
  if (!acceptTerms) errors.push({ field: 'acceptTerms', code: 'val.terms_required' });
  if (errors.length) throw new HttpError(422, 'val.failed', { errors });
  if (!registrationOpen()) throw new HttpError(403, 'err.registration_closed');
  if (get(`SELECT 1 ok FROM users WHERE lower(email) = lower(:e)`, { e })) throw new HttpError(409, 'auth.email_taken', { field: 'email' });
  if (get(`SELECT 1 ok FROM users WHERE lower(username) = lower(:u)`, { u })) throw new HttpError(409, 'auth.username_taken', { field: 'username' });
  const hash = hashPassword(password);
  return tx(() => {
    const r = run(
      `INSERT INTO users(email, username, password_hash, locale, avatar, marketing_optin, birthdate)
       VALUES(:e,:u,:h,:l,:a,:m,:b)`,
      { e, u, h: hash, l: ['en', 'bn'].includes(locale) ? locale : config.locale.default, a: AVATARS[Math.floor(Math.random() * AVATARS.length)], m: 0, b: null }
    );
    const id = Number(r.lastInsertRowid);
    wallet.ensureWallet(id);
    const bonus = wallet.grantSignupBonus(id);
    if (bonus) notifyUser(id, { titleKey: 'notif.bonus_credited', bodyKey: 'notif.bonus_credited_body', params: { amount: bonus }, level: 'success', icon: 'gift', link: '/account/wallet' });
    if (referral) run(`INSERT INTO audit_logs(action, entity, entity_id, meta) VALUES('user.referral','user',:id,:meta)`, { id, meta: JSON.stringify({ referral: String(referral).slice(0, 40) }) });
    audit({ actorId: id, actorRole: 'user', action: 'auth.register', entity: 'user', entityId: id, ip, meta: { username: u } });
    return publicUser(get(`SELECT * FROM users WHERE id = :id`, { id }));
  });
}

export function createSession(userId, { ip, userAgent }) {
  const sid = token(32);
  const csrf = token(24);
  const expires = new Date(Date.now() + config.sessionTtlDays * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  run(
    `INSERT INTO sessions(id, user_id, csrf_token, ip_hash, user_agent, expires_at) VALUES(:sid,:u,:c,:ip,:ua,:e)`,
    { sid, u: userId, c: csrf, ip: ip ? crypto.createHash('sha256').update(`${config.ipSalt}|${ip}`).digest('hex').slice(0, 32) : null, ua: String(userAgent || '').slice(0, 180), e: expires }
  );
  run(`UPDATE users SET last_login_at = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = :u`, { u: userId });
  return { sid, csrf, expiresAt: expires };
}

export function login({ identifier, password, ip, userAgent }) {
  const row = findByEmailOrUsername(identifier);
  const started = Date.now();
  const fail = (code, params = {}) => {
    if (row) {
      const attempts = (row.failed_attempts || 0) + 1;
      const lock = attempts >= 8 ? daysFromNow(0) : null;
      run(`UPDATE users SET failed_attempts = :a, locked_until = CASE WHEN :lock = 1 THEN datetime('now','+15 minutes') ELSE locked_until END WHERE id = :id`,
        { a: attempts, id: row.id, lock: attempts >= 8 ? 1 : 0 });
      audit({ actorId: row.id, actorRole: 'user', action: 'auth.login_failed', entity: 'user', entityId: row.id, ip });
    }
    // Constant-ish work so timing does not reveal whether the account exists.
    const wait = Math.max(0, 120 - (Date.now() - started));
    return { code, params, wait };
  };
  if (!row) { fail('auth.invalid_credentials'); return { error: 'auth.invalid_credentials' }; }
  if (row.locked_until && new Date(String(row.locked_until).replace(' ', 'T') + 'Z') > new Date()) return { error: 'auth.locked', params: { until: row.locked_until } };
  if (!verifyPassword(password, row.password_hash)) return { error: 'auth.invalid_credentials' };
  if (row.status === 'closed') return { error: 'auth.account_closed' };
  if (row.status === 'suspended') return { error: 'auth.account_suspended' };
  const s = createSession(row.id, { ip, userAgent });
  audit({ actorId: row.id, actorRole: row.role, action: 'auth.login', entity: 'user', entityId: row.id, ip });
  return { ...s, user: publicUser(get(`SELECT * FROM users WHERE id = :id`, { id: row.id })) };
}

export function resolveSession(sid) {
  if (!sid) return null;
  const row = get(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.created_at AS session_created_at, u.*
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = :sid`, { sid: String(sid).slice(0, 128) }
  );
  if (!row) return null;
  if (new Date(String(row.expires_at).replace(' ', 'T') + 'Z') < new Date()) {
    run(`DELETE FROM sessions WHERE id = :id`, { id: row.session_id });
    return null;
  }
  if (row.status !== 'active') return null;
  const { session_id, csrf_token, expires_at, session_created_at, password_hash, reset_token_hash, ...user } = row;
  if (Date.now() % 60 < 30) run(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = :id`, { id: session_id });
  // `raw` keeps the internal columns services need (limits, status) but never
  // password material, and is never serialised into a response body.
  return { sessionId: session_id, csrf: csrf_token, sessionCreatedAt: session_created_at, expiresAt: expires_at, user: publicUser(user), raw: { ...user, password_hash: undefined, reset_token_hash: undefined } };
}

export function logout(sid) {
  if (!sid) return;
  run(`DELETE FROM sessions WHERE id = :id`, { id: String(sid).slice(0, 128) });
}

export function logoutEverywhere(userId, exceptSessionId = null) {
  if (exceptSessionId) run(`DELETE FROM sessions WHERE user_id = :u AND id != :s`, { u: userId, s: exceptSessionId });
  else run(`DELETE FROM sessions WHERE user_id = :u`, { u: userId });
}

export function requestPasswordReset(email, ip) {
  const e = String(email || '').trim().toLowerCase();
  const row = get(`SELECT * FROM users WHERE lower(email) = lower(:e)`, { e });
  const respond = { ok: true, code: 'auth.reset_requested' };
  if (!row) return respond; // never reveal whether the address exists
  const raw = token(24);
  run(`UPDATE users SET reset_token_hash = :h, reset_expires_at = datetime('now','+30 minutes') WHERE id = :id`, { h: sha256(raw), id: row.id });
  const link = `/reset-password?token=${raw}`;
  sendMail({
    to: row.email,
    kind: 'password_reset',
    subject: 'ArenaPlay — reset your password / পাসওয়ার্ড রিসেট করুন',
    body: `Use this link within 30 minutes to set a new password.\n${link}\n\nIf you did not request this, ignore this message. Demo mode: no real money is involved.`,
    link,
  });
  audit({ actorId: row.id, actorRole: 'user', action: 'auth.password_reset_requested', entity: 'user', entityId: row.id, ip });
  return respond;
}

export function confirmPasswordReset(rawToken, password) {
  const h = sha256(String(rawToken || ''));
  const row = get(`SELECT * FROM users WHERE reset_token_hash = :h AND reset_expires_at > datetime('now')`, { h });
  if (!row) throw new HttpError(400, 'auth.reset_invalid');
  const issues = passwordIssues(password);
  if (issues.length) throw new HttpError(422, 'val.failed', { errors: issues.map((code) => ({ field: 'password', code })) });
  tx(() => {
    run(`UPDATE users SET password_hash = :h, reset_token_hash = NULL, reset_expires_at = NULL, failed_attempts = 0, locked_until = NULL WHERE id = :id`, { h: hashPassword(password), id: row.id });
    logoutEverywhere(row.id);
    notifyUser(row.id, { titleKey: 'notif.password_changed', bodyKey: 'notif.password_changed_body', level: 'warn', icon: 'shield' });
  });
  audit({ actorId: row.id, actorRole: 'user', action: 'auth.password_reset_completed', entity: 'user', entityId: row.id });
  return { ok: true, code: 'auth.reset_done' };
}

export function changePassword(userId, currentPassword, newPassword, sessionId) {
  const row = get(`SELECT * FROM users WHERE id = :id`, { id: userId });
  if (!verifyPassword(currentPassword, row.password_hash)) throw new HttpError(403, 'auth.wrong_password');
  const issues = passwordIssues(newPassword);
  if (issues.length) throw new HttpError(422, 'val.failed', { errors: issues.map((code) => ({ field: 'password', code })) });
  tx(() => {
    run(`UPDATE users SET password_hash = :h WHERE id = :id`, { h: hashPassword(newPassword), id: userId });
    run(`DELETE FROM sessions WHERE user_id = :u AND id != :s`, { u: userId, s: sessionId || '' });
    notifyUser(userId, { titleKey: 'notif.password_changed', bodyKey: 'notif.password_changed_body', level: 'warn', icon: 'shield' });
  });
  audit({ actorId: userId, actorRole: row.role, action: 'auth.password_changed', entity: 'user', entityId: userId });
  return { ok: true };
}

export function updateProfile(userId, patch) {
  const u = get(`SELECT * FROM users WHERE id = :id`, { id: userId });
  const fields = [];
  const p = { id: userId };
  const set = (col, val) => { fields.push(`${col} = :${col}`); p[col] = val; };
  if (patch.email !== undefined) {
    const e = String(patch.email).trim().toLowerCase();
    if (!emailOk(e)) throw new HttpError(422, 'val.failed', { errors: [{ field: 'email', code: 'val.email' }] });
    if (get(`SELECT 1 ok FROM users WHERE lower(email)=lower(:e) AND id != :id`, { e, id: userId })) throw new HttpError(409, 'auth.email_taken', { field: 'email' });
    set('email', e);
    set('email_verified', 0);
  }
  if (patch.username !== undefined) {
    const un = String(patch.username).trim();
    if (!usernameOk(un)) throw new HttpError(422, 'val.failed', { errors: [{ field: 'username', code: 'val.username' }] });
    if (get(`SELECT 1 ok FROM users WHERE lower(username)=lower(:u) AND id != :id`, { u: un, id: userId })) throw new HttpError(409, 'auth.username_taken', { field: 'username' });
    set('username', un);
  }
  if (patch.locale !== undefined) set('locale', ['en', 'bn'].includes(patch.locale) ? patch.locale : 'en');
  if (patch.avatar !== undefined) set('avatar', AVATARS.includes(patch.avatar) ? patch.avatar : 'star');
  if (patch.phone !== undefined) set('phone', String(patch.phone).slice(0, 24));
  if (patch.country !== undefined) set('country', String(patch.country).slice(0, 60));
  if (patch.birthdate !== undefined) {
    const b = String(patch.birthdate).slice(0, 10);
    if (b && !/^\d{4}-\d{2}-\d{2}$/.test(b)) throw new HttpError(422, 'val.failed', { errors: [{ field: 'birthdate', code: 'val.date_invalid' }] });
    if (b) {
      const age = (Date.now() - Date.parse(b + 'T00:00:00Z')) / 31557600000;
      if (age < 18 || age > 120) throw new HttpError(422, 'val.age_required');
    }
    set('birthdate', b || null);
  }
  if (patch.marketingOptin !== undefined) set('marketing_optin', patch.marketingOptin ? 1 : 0);
  if (patch.notifyEmail !== undefined) set('notify_email', patch.notifyEmail ? 1 : 0);
  if (patch.notifyPush !== undefined) set('notify_push', patch.notifyPush ? 1 : 0);
  if (!fields.length) return publicUser(u);
  run(`UPDATE users SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = :id`, p);
  audit({ actorId: userId, action: 'account.profile_updated', entity: 'user', entityId: userId, meta: Object.keys(patch) });
  return publicUser(get(`SELECT * FROM users WHERE id = :id`, { id: userId }));
}

export function setLimits(userId, patch) {
  const p = { id: userId };
  const fields = [];
  const cents = (v) => (v === null || v === '' || v === undefined ? null : Math.round(clamp(Number(v), 10000, config.demo.maxBalanceCents)));
  if (patch.dailyLossLimit !== undefined) { fields.push('daily_loss_limit = :dl'); p.dl = cents(patch.dailyLossLimit); }
  if (patch.weeklyWagerLimit !== undefined) { fields.push('weekly_wager_limit = :wl'); p.wl = cents(patch.weeklyWagerLimit); }
  if (patch.sessionLimitMin !== undefined) { fields.push('session_limit_min = :sm'); p.sm = patch.sessionLimitMin === null ? null : Math.round(clamp(Number(patch.sessionLimitMin), 5, 600)); }
  if (patch.realityCheck !== undefined) { fields.push('reality_check = :rc'); p.rc = patch.realityCheck ? 1 : 0; }
  if (!fields.length) return { ok: true };
  run(`UPDATE users SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = :id`, p);
  audit({ actorId: userId, action: 'account.limits_set', entity: 'user', entityId: userId, meta: p });
  return { ok: true, limits: publicUser(get(`SELECT * FROM users WHERE id = :id`, { id: userId })).limits };
}

export function selfExclude(userId, hours) {
  const h = Number(hours);
  if (h === 0 || h === '0' || h === null) {
    run(`UPDATE users SET self_exclusion_until = NULL WHERE id = :u`, { u: userId });
    audit({ actorId: userId, action: 'account.self_exclusion_lifted', entity: 'user', entityId: userId });
    notifyUser(userId, { titleKey: 'notif.self_exclusion_lifted', level: 'info', icon: 'shield' });
    return { selfExclusionUntil: null };
  }
  if (!Number.isFinite(h) || h < 1 || h > 24 * 90) throw new HttpError(422, 'rg.exclude_invalid');
  const until = new Date(Date.now() + h * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  run(`UPDATE users SET self_exclusion_until = :t WHERE id = :u`, { t: until, u: userId });
  logoutEverywhere(userId);
  audit({ actorId: userId, action: 'account.self_exclusion', entity: 'user', entityId: userId, meta: { hours: h } });
  notifyUser(userId, { titleKey: 'notif.self_excluded', bodyKey: 'notif.self_excluded_body', params: { until }, level: 'warn', icon: 'shield' });
  return { selfExclusionUntil: until };
}

export function closeAccount(userId, password) {
  const u = get(`SELECT * FROM users WHERE id = :id`, { id: userId });
  if (!verifyPassword(password, u.password_hash)) throw new HttpError(403, 'auth.wrong_password');
  tx(() => {
    run(`UPDATE users SET status = 'closed', updated_at = datetime('now') WHERE id = :id`, { id: userId });
    logoutEverywhere(userId);
  });
  audit({ actorId: userId, action: 'account.closed', entity: 'user', entityId: userId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin-side user management
// ---------------------------------------------------------------------------
export function listUsers({ q = null, role = null, status = null, limit = 25, offset = 0 } = {}) {
  const p = { limit: Math.min(200, Math.max(1, limit)), offset: Math.max(0, offset) };
  const where = ['1=1'];
  if (q) { where.push('(u.email LIKE :q OR u.username LIKE :q OR CAST(u.id AS TEXT) = :qid)'); p.q = `%${String(q).slice(0, 60)}%`; p.qid = String(q).replace(/\D/g, '') || '0'; }
  if (role) { where.push('u.role = :role'); p.role = role; }
  if (status) { where.push('u.status = :status'); p.status = status; }
  const rows = all(
    `SELECT u.*, COALESCE(w.balance,0) AS balance, COALESCE(w.lifetime_wagered,0) AS wagered,
            (SELECT COUNT(*) FROM bets b WHERE b.user_id = u.id) AS bets_count
     FROM users u LEFT JOIN user_wallets w ON w.user_id = u.id
     WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT :limit OFFSET :offset`, p
  );
  const total = get(`SELECT COUNT(*) c FROM users u WHERE ${where.join(' AND ')}`, p)?.c ?? 0;
  return {
    rows: rows.map((r) => ({ ...publicUser(r), balance: r.balance, lifetimeWagered: r.wagered, betsCount: r.bets_count })),
    total,
  };
}

export function adminUpdateUser(actor, targetId, patch, ip) {
  const target = get(`SELECT * FROM users WHERE id = :id`, { id: targetId });
  if (!target) throw new HttpError(404, 'err.user_not_found');
  const fields = [];
  const p = { id: targetId };
  if (patch.status !== undefined) {
    if (!['active', 'suspended', 'closed'].includes(patch.status)) throw new HttpError(422, 'val.enum', { field: 'status' });
    fields.push('status = :st'); p.st = patch.status;
  }
  if (patch.role !== undefined) {
    if (!['user', 'moderator', 'admin'].includes(patch.role)) throw new HttpError(422, 'val.enum', { field: 'role' });
    if (target.role === 'admin' && patch.role !== 'admin' && actor.id === target.id) throw new HttpError(403, 'admin.no_self_demote');
    fields.push('role = :ro'); p.ro = patch.role;
  }
  if (patch.lockedUntil !== undefined) {
    fields.push('locked_until = :lu', 'failed_attempts = 0');
    p.lu = patch.lockedUntil ? new Date(patch.lockedUntil).toISOString().replace('T', ' ').slice(0, 19) : null;
  }
  if (patch.selfExclusionUntil !== undefined) {
    fields.push('self_exclusion_until = :se');
    p.se = patch.selfExclusionUntil ? new Date(patch.selfExclusionUntil).toISOString().replace('T', ' ').slice(0, 19) : null;
  }
  if (patch.resetPassword !== undefined) {
    const issues = passwordIssues(patch.resetPassword);
    if (issues.length) throw new HttpError(422, 'val.failed', { errors: issues.map((code) => ({ field: 'password', code })) });
    fields.push('password_hash = :ph', 'failed_attempts = 0', 'locked_until = NULL');
    p.ph = hashPassword(patch.resetPassword);
    run(`DELETE FROM sessions WHERE user_id = :id`, { id: targetId });
  }
  if (!fields.length) return publicUser(target);
  run(`UPDATE users SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = :id`, p);
  audit({ actorId: actor.id, actorRole: actor.role, action: 'admin.user_updated', entity: 'user', entityId: targetId, meta: { ...patch }, ip });
  notifyUser(targetId, { titleKey: 'notif.admin_update', bodyKey: 'notif.admin_update_body', params: { fields: Object.keys(patch) }, level: 'info', link: '/account' });
  return publicUser(get(`SELECT * FROM users WHERE id = :id`, { id: targetId }));
}

export function adminAdjustCredits(actor, targetId, { amount, reason }, ip) {
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) throw new HttpError(422, 'err.amount_required');
  if (!String(reason || '').trim() || String(reason).trim().length < 4) throw new HttpError(422, 'admin.reason_required');
  const target = get(`SELECT * FROM users WHERE id = :id`, { id: targetId });
  if (!target) throw new HttpError(404, 'err.user_not_found');
  return tx(() => {
    const bal = wallet.credit({
      userId: targetId, amount: amt, kind: amt > 0 ? 'admin_credit' : 'admin_debit',
      noteKey: 'wallet.note.admin_adjust', note: String(reason).slice(0, 200), reference: `admin:${actor.id}`,
    });
    audit({ actorId: actor.id, actorRole: actor.role, action: 'admin.credits_adjusted', entity: 'user', entityId: targetId, meta: { amount: amt, reason: String(reason).slice(0, 200), balanceAfter: bal }, ip });
    notifyUser(targetId, { titleKey: amt > 0 ? 'notif.credit_added' : 'notif.credit_removed', bodyKey: 'notif.credit_change_body', params: { amount: Math.abs(amt) }, level: amt > 0 ? 'success' : 'warn', link: '/account/wallet' });
    return { balance: bal };
  });
}

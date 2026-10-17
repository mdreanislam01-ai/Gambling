import config from '../config.js';
import { all } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { serializeCookie } from '../lib/http.js';
import * as users from '../services/users.js';
import { walletSummary, transactions, dailyResetBonus } from '../services/wallet.js';
import { stats } from '../services/bets.js';
import { toCents, emailOk } from '../lib/util.js';

export function setCookie(ctx, name, value, opts = {}) {
  const cur = ctx.res.getHeader('Set-Cookie');
  const arr = cur ? (Array.isArray(cur) ? cur : [cur]) : [];
  arr.push(serializeCookie(name, value, { secure: config.cookie.secure, ...opts }));
  ctx.res.setHeader('Set-Cookie', arr);
}

export const readStake = (body) => {
  const raw = body?.stakeCents ?? body?.stake ?? body?.amount;
  if (typeof raw === 'string' && raw.includes('.')) {
    const c = toCents(raw);
    if (Number.isFinite(c)) return Math.round(c);
  }
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) throw new HttpError(400, 'err.stake_invalid');
  return n;
};

export function registerAuthRoutes(route) {
  route('GET', '/api/auth/session', (ctx) => {
    if (!ctx.session) return { authenticated: false };
    return {
      authenticated: true,
      user: ctx.user,
      csrf: ctx.session.csrf,
      session: { createdAt: ctx.session.sessionCreatedAt, expiresAt: ctx.session.expiresAt },
      wallet: walletSummary(ctx.user.id),
    };
  });

  route('POST', '/api/auth/register', { limit: 'register', csrf: false }, (ctx) => {
    const b = ctx.body || {};
    if (b.website) throw new HttpError(422, 'val.spam'); // honeypot
    const user = users.register({
      email: b.email, username: b.username, password: b.password, locale: b.locale,
      confirmAge: b.confirmAge, acceptTerms: b.acceptTerms, referral: b.referral, ip: ctx.ip,
    });
    const s = users.createSession(user.id, { ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    setCookie(ctx, config.cookie.name, s.sid, { maxAge: config.sessionTtlDays * 86400 });
    ctx.setLocale?.(user.locale);
    return { user, csrf: s.csrf, wallet: walletSummary(user.id), created: true };
  });

  route('POST', '/api/auth/login', { limit: 'login', csrf: false }, (ctx) => {
    const b = ctx.body || {};
    const out = users.login({ identifier: b.identifier || b.email, password: b.password, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    if (out.error) throw new HttpError(401, out.error, out.params || {});
    setCookie(ctx, config.cookie.name, out.sid, { maxAge: config.sessionTtlDays * 86400 });
    dailyResetBonus(out.user.id);
    return { user: out.user, csrf: out.csrf, wallet: walletSummary(out.user.id) };
  });

  route('POST', '/api/auth/logout', { auth: true }, (ctx) => {
    users.logout(ctx.session.sessionId);
    setCookie(ctx, config.cookie.name, '', { maxAge: 0 });
    return { ok: true };
  });

  route('POST', '/api/auth/forgot', { limit: 'reset', csrf: false }, (ctx) => {
    const email = String(ctx.body?.email || '').trim();
    if (!emailOk(email)) throw new HttpError(422, 'val.failed', { errors: [{ field: 'email', code: 'val.email' }] });
    const out = users.requestPasswordReset(email, ctx.ip);
    return { ...out, ...(config.isProd ? {} : { devHint: 'Demo build: open /demo-mailbox to read the reset link.' }) };
  });

  route('POST', '/api/auth/reset', { limit: 'reset', csrf: false }, (ctx) => {
    return users.confirmPasswordReset(ctx.body?.token, ctx.body?.password);
  });

  route('POST', '/api/auth/password', { auth: true, limit: 'write' }, (ctx) => {
    users.changePassword(ctx.user.id, ctx.body?.currentPassword, ctx.body?.newPassword, ctx.session.sessionId);
    return { ok: true, code: 'auth.password_updated' };
  });

  route('PATCH', '/api/account/profile', { auth: true, limit: 'write' }, (ctx) => {
    const user = users.updateProfile(ctx.user.id, ctx.body || {});
    ctx.setLocale?.(user.locale);
    return { user };
  });

  route('POST', '/api/account/locale', { csrf: false, limit: 'write' }, (ctx) => {
    const code = ['en', 'bn'].includes(ctx.body?.locale) ? ctx.body.locale : 'en';
    ctx.setLocale?.(code);
    if (ctx.user) users.updateProfile(ctx.user.id, { locale: code });
    return { locale: code };
  });

  route('GET', '/api/account/summary', { auth: true }, (ctx) => {
    const summary = stats.userGameStats(ctx.user.id);
    return {
      user: ctx.user,
      wallet: walletSummary(ctx.user.id),
      games: summary ?? null,
      recentTransactions: transactions(ctx.user.id, { limit: 8 }),
    };
  });

  route('GET', '/api/account/sessions', { auth: true }, (ctx) => {
    return { rows: all(`SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt, user_agent AS userAgent
                        FROM sessions WHERE user_id = :u ORDER BY created_at DESC LIMIT 20`, { u: ctx.user.id })
      .map((s) => ({ ...s, current: s.id === ctx.session.sessionId, id: `${String(s.id).slice(0, 6)}…` })) };
  });

  route('POST', '/api/account/sessions/revoke', { auth: true }, (ctx) => {
    if (ctx.body?.all) { users.logoutEverywhere(ctx.user.id, ctx.session.sessionId); return { revoked: 'others' }; }
    return { ok: true, code: 'account.sessions_revoked' };
  });

  route('POST', '/api/account/close', { auth: true }, (ctx) => {
    users.closeAccount(ctx.user.id, ctx.body?.password);
    setCookie(ctx, config.cookie.name, '', { maxAge: 0 });
    return { ok: true, code: 'account.closed' };
  });
}

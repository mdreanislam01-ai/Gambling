import crypto from 'node:crypto';
import { Router, HttpError, sendError, sendJson, serveStatic, buildContext, readBody, serializeCookie, applySecurityHeaders } from '../lib/http.js';
import { RateLimiter } from '../lib/security.js';
import config from '../config.js';
import { resolveSession, publicUser } from '../services/users.js';
import { isMaintenance, registrationOpen } from '../services/settings.js';
import { logError } from '../services/audit.js';
import { json } from '../lib/util.js';
import { registerAuthRoutes } from './auth.js';
import { registerGameRoutes } from './game.js';
import { registerSportsRoutes } from './sports.js';
import { registerAccountRoutes } from './account.js';
import { registerAdminRoutes } from './admin.js';
import { registerSystemRoutes } from './system.js';

export const limiters = {
  login: new RateLimiter(config.limits.login),
  register: new RateLimiter(config.limits.register),
  bet: new RateLimiter(config.limits.bet),
  write: new RateLimiter(config.limits.write),
  reset: new RateLimiter({ max: 5, windowS: 900 }),
};

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function createApp() {
  const router = new Router();

  const route = (method, path, opts, handler) => {
    if (typeof opts === 'function') { handler = opts; opts = {}; }
    router.add(method, path, async (ctx) => {
      if (opts.limit && limiters[opts.limit]) {
        const r = limiters[opts.limit].hit(`${opts.limit}:${ctx.ip}:${opts.auth === 'admin' ? 'adm' : 'usr'}`);
        if (!r.ok) throw new HttpError(429, 'err.rate_limited', { retryAfterS: Math.ceil(r.resetMs / 1000) });
        ctx.state.rateRemaining = r.remaining;
      }
      if (opts.auth) {
        if (!ctx.session) throw new HttpError(401, 'auth.required');
        if (opts.auth === 'admin' && ctx.user.role !== 'admin') throw new HttpError(403, 'err.forbidden_admin');
        if (opts.auth === 'staff' && !['admin', 'moderator'].includes(ctx.user.role)) throw new HttpError(403, 'err.forbidden');
        if (opts.csrf !== false && MUTATING.has(ctx.method) && ctx.csrfOk !== true) throw new HttpError(403, 'err.csrf');
      }
      if (isMaintenance() && opts.auth !== 'admin' && !path.startsWith('/api/admin') && !['/api/health', '/api/content'].includes(path) && !path.startsWith('/api/auth')) {
        const u = ctx.user;
        if (!u || u.role !== 'admin') throw new HttpError(503, 'err.maintenance', { messageKey: String((await import('../services/settings.js')).setting('maintenance_message_key')) });
      }
      const out = await handler(ctx);
      if (out === undefined) return null;
      return out;
    });
  };

  registerSystemRoutes(route);
  registerAuthRoutes(route);
  registerGameRoutes(route);
  registerSportsRoutes(route);
  registerAccountRoutes(route);
  registerAdminRoutes(route);

  return router;
}

const app = createApp();

export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ctx = buildContext(req, res, url);
  const cspNonce = crypto.randomBytes(12).toString('base64url').replace(/[+/=]/g, '');
  applySecurityHeaders(res, { cspNonce });
  ctx.nonce = cspNonce;
  try {
    // Session / locale
    const sid = ctx.cookies[config.cookie.name];
    const s = resolveSession(sid);
    if (s) {
      ctx.session = s;
      ctx.user = s.user;
      ctx.rawUser = s.raw;
      ctx.csrfOk = !MUTATING.has(ctx.method)
        || (!!req.headers['x-csrf-token'] && req.headers['x-csrf-token'] === s.csrf);
    } else if (MUTATING.has(ctx.method)) {
      ctx.csrfOk = true; // anonymous mutations are protected by their own rate limits + captcha hooks
    }
    const qLocale = ctx.query?.locale;
    ctx.locale = (config.locale.supported.includes(qLocale) ? qLocale : null)
      || ctx.user?.locale
      || (config.locale.supported.includes(ctx.cookies[config.cookie.locale]) ? ctx.cookies[config.cookie.locale] : config.locale.default);
    if (MUTATING.has(ctx.method) && sid && !s) {
      const cur = res.getHeader('Set-Cookie');
      const arr = cur ? (Array.isArray(cur) ? cur : [cur]) : [];
      arr.push(serializeCookie(config.cookie.name, '', { maxAge: 0 }));
      res.setHeader('Set-Cookie', arr);
    }
    const body = await readBody(ctx);
    ctx.body = body ?? {};
    ctx.setLocale = (code) => {
      const cur = res.getHeader('Set-Cookie');
      const arr = cur ? (Array.isArray(cur) ? cur : [cur]) : [];
      arr.push(serializeCookie(config.cookie.locale, code, { maxAge: 60 * 60 * 24 * 365, httpOnly: false }));
      res.setHeader('Set-Cookie', arr);
    };

    if (url.pathname.startsWith('/api/')) {
      const found = app.match(ctx.method, url.pathname);
      if (!found) throw new HttpError(404, 'err.route_not_found', { path: url.pathname });
      ctx.params = found.params;
      const data = await found.route.handler(ctx);
      if (res.writableEnded) return;
      sendJson(res, { ok: true, data: data === undefined ? null : data }, 200, ctx);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'err.method_not_allowed');
    // Static + SPA fallback
    const inject = {
      nonce: ctx.nonce,
      locale: ctx.locale,
      boot: JSON.stringify({
        locale: ctx.locale,
        authenticated: !!ctx.user,
        user: ctx.user ?? null,
        csrf: ctx.session?.csrf ?? null,
        maintenance: isMaintenance(),
        demo: config.demo,
        env: config.isProd ? 'production' : 'development',
        version: '1.0.0',
        flags: { registrationOpen: registrationOpen() },
      }).replace(/</g, '\\u003c'),
    };
    if (serveStatic(config.publicDir, url.pathname, req, res, inject)) return;
    if (serveStatic(config.publicDir, '/index.html', req, res, inject)) return;
    throw new HttpError(404, 'err.not_found');
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    if (status >= 500) {
      logError({
        code: err?.code || 'http.unhandled', message: err?.message || String(err), stack: err?.stack,
        path: url.pathname, userId: ctx?.user?.id ?? null, meta: { method: req.method, query: Object.fromEntries(url.searchParams.entries()) },
      });
      if (!config.isProd) console.error('[error]', err);
    }
    sendError(res, err, { expose: !config.isProd && process.env.EXPOSE_ERRORS === '1' });
  }
}

export { HttpError, sendJson };

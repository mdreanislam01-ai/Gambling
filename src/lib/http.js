import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

export class HttpError extends Error {
  constructor(status, code, params = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.params = params;
  }
}
export const httpError = HttpError;

/** Security headers on every response. CSP avoids unsafe-inline by using nonces. */
export function applySecurityHeaders(res, { cspNonce } = {}) {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${cspNonce ? ` 'nonce-${cspNonce}'` : ''}`,
    `style-src 'self' 'unsafe-inline'${cspNonce ? ` 'nonce-${cspNonce}'` : ''}`,
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? '')}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  parts.push(`SameSite=${opts.sameSite ?? config.cookie.sameSite}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure ?? config.cookie.secure) parts.push('Secure');
  return parts.join('; ');
}

export class Router {
  constructor() {
    this.routes = [];
    this.middleware = [];
  }
  use(fn) { this.middleware.push(fn); return this; }
  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/\/+$/, '')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\\\/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; })
          .replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) +
        '/?$'
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }
  get = (p, h) => this.add('GET', p, h);
  post = (p, h) => this.add('POST', p, h);
  patch = (p, h) => this.add('PATCH', p, h);
  put = (p, h) => this.add('PUT', p, h);
  delete = (p, h) => this.add('DELETE', p, h);

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = safeDecode(m[i + 1]); });
      return { route: r, params };
    }
    return null;
  }

  methodsFor(pathname) {
    const out = new Set();
    for (const r of this.routes) if (r.regex.test(pathname)) out.add(r.method);
    return [...out];
  }
}

const safeDecode = (v) => { try { return decodeURIComponent(v); } catch { return v; } };

export function buildContext(req, res, url) {
  const ipHeader = config.trustProxy ? req.headers['x-forwarded-for'] : null;
  const ip = (ipHeader ? String(ipHeader).split(',')[0] : req.socket.remoteAddress || '').trim();
  const ctx = {
    req, res, url,
    method: req.method === 'HEAD' ? 'GET' : req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    params: {},
    cookies: parseCookies(req.headers.cookie || ''),
    ip,
    body: null,
    user: null,
    session: null,
    locale: config.locale.default,
    startedAt: process.hrtime.bigint(),
    _nonce: crypto.randomBytes(12).toString('base64url'),
    state: {},
  };
  ctx.json = (data, status = 200) => sendJson(res, data, status, ctx);
  ctx.noStore = true;
  return ctx;
}

export async function readBody(ctx) {
  const { req } = ctx;
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const len = Number(req.headers['content-length'] || 0);
  const type = String(req.headers['content-type'] || '');
  if (!len && type.includes('json') === false && type !== '') return null;
  const limit = config.maxBodyBytes;
  /**
   * Refuse the payload but drain the socket: if we answer 413 while the rest of
   * the body is still inbound, the connection cannot be reused and the client's
   * next keep-alive request fails with a bare connection error.
   */
  const reject = () => { req.resume(); throw new HttpError(413, 'err.body_too_large', { limit }); };
  if (len > limit) reject();
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) reject();
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw).entries());
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { value: parsed };
  } catch {
    throw new HttpError(400, 'err.bad_json');
  }
}

export function sendJson(res, data, status = 200, ctx) {
  if (res.writableEnded || res.headersSent) return;
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    Vary: 'Cookie',
  });
  res.end(ctx?.method === 'HEAD' ? undefined : body);
}

export function sendError(res, err, { expose = false } = {}) {
  const status = Number.isInteger(err?.status) ? err.status : 500;
  const code = status === 500 && !expose ? 'err.internal' : err?.code || 'err.internal';
  const params = status === 500 && !expose ? {} : err?.params || {};
  const body = JSON.stringify({ ok: false, error: { code, params, ...(config.isTest || expose ? { detail: String(err?.message || '') } : {}) } });
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

const statCache = new Map();
export function serveStatic(dir, pathname, req, res, inject = {}) {
  const nonce = typeof inject === 'string' ? inject : inject.nonce;
  const relPath = path.posix.normalize(pathname.replace(/^\/+/, '')) || 'index.html';
  if (relPath.includes('..') || path.posix.isAbsolute(relPath)) { res.writeHead(403).end('forbidden'); return true; }
  const file = path.join(dir, relPath);
  if (!file.startsWith(path.resolve(dir) + path.sep) && file !== path.resolve(dir)) { res.writeHead(403).end('forbidden'); return true; }
  let st = statCache.get(file);
  const now = Date.now();
  if (!st || now - st.at > 1000) {
    st = { at: now, stat: fs.existsSync(file) && fs.statSync(file).isFile() ? fs.statSync(file) : null };
    statCache.set(file, st);
  }
  if (!st.stat) return false;
  const etag = `W/"${st.stat.size}-${Number(st.stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return true; }
  const ext = path.extname(file).toLowerCase();
  const isHtml = ext === '.html';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Last-Modified': st.stat.mtime.toUTCString(),
    'Cache-Control': isHtml ? 'no-cache' : ext === '.js' || ext === '.css' ? 'public, max-age=0, must-revalidate' : 'public, max-age=600',
  };
  if (isHtml) {
    let html = fs.readFileSync(file, 'utf8');
    html = html
      .replaceAll('%CSP_NONCE%', nonce || '')
      .replaceAll('%LOCALE%', /^[a-z-]{2,5}$/.test(String(inject.locale || '')) ? inject.locale : 'en')
      .replaceAll('%BOOT%', typeof inject.boot === 'string' ? inject.boot : '{}');
    const buf = Buffer.from(html, 'utf8');
    headers['Content-Length'] = buf.length;
    res.writeHead(200, headers).end(buf);
    return true;
  }
  headers['Content-Length'] = st.stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

/** Server-sent events hub used by the live crash/live-casino feed. */
export class SseHub {
  constructor(name) { this.name = name; this.clients = new Set(); }
  add(res, meta = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);
    const client = { res, id: crypto.randomBytes(6).toString('hex'), userId: meta.userId ?? null };
    this.clients.add(client);
    return client;
  }
  remove(client) { this.clients.delete(client); }
  /**
   * `target.userId` limits delivery to that user's own connections. Private
   * events (wallet, notifications, a player's bets) must never reach strangers.
   */
  send(event, data, target = {}) {
    const only = target.userId ?? null;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients) {
      if (only !== null && c.userId !== only) continue;
      try { c.res.write(payload); } catch { this.clients.delete(c); }
    }
  }
  get size() { return this.clients.size; }
  closeAll() { for (const c of this.clients) { try { c.res.end(); } catch {} } this.clients.clear(); }
}

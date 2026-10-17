/** API client: JSON in/out, CSRF header, typed error objects, offline guard. */
let csrfToken = null;
const inflight = new Map();

export const setCsrf = (token) => { csrfToken = token || null; };

export class ApiError extends Error {
  constructor(status, code, params) {
    super(code);
    this.status = status;
    this.code = code;
    this.params = params || {};
    this.isApiError = true;
  }
}

async function request(method, path, body, opts = {}) {
  const init = {
    method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  if (csrfToken && method !== 'GET') init.headers['x-csrf-token'] = csrfToken;
  if (opts.signal) init.signal = opts.signal;
  const res = await fetch(path, init);
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { ok: false, error: { code: 'err.bad_response' } }; }
  if (!res.ok || payload?.ok === false) {
    const err = payload?.error || { code: 'err.network', params: {} };
    throw new ApiError(res.status, err.code || 'err.network', err.params || {});
  }
  if (payload?.data?.csrf) csrfToken = payload.data.csrf;
  return payload?.data;
}

export const api = {
  get: (path, opts) => request('GET', `/api${path}`, undefined, opts),
  post: (path, body, opts) => request('POST', `/api${path}`, body ?? {}, opts),
  patch: (path, body, opts) => request('PATCH', `/api${path}`, body ?? {}, opts),
  del: (path, body, opts) => request('DELETE', `/api${path}`, body ?? {}, opts),
  /** Raw (non-JSON) endpoints such as CSV exports. */
  file: async (path) => {
    const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'err.export_failed', {});
    return res.blob();
  },
  setCsrf,
  /** GET with a short de-dupe window so nav spam does not refetch everything. */
  async cached(path, ttlMs = 15000) {
    const hit = inflight.get(path);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = request('GET', `/api${path}`);
    inflight.set(path, { at: Date.now(), value });
    value.catch(() => inflight.delete(path));
    return value;
  },
  invalidate: (prefix = '') => {
    for (const k of [...inflight.keys()]) if (!prefix || k.startsWith(prefix)) inflight.delete(k);
  },
};

export const errorKeyFor = (err) => (err?.isApiError ? err.code : 'err.network');

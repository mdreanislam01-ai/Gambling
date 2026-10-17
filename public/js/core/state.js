/** Minimal observable store — one object, explicit patches, no framework. */
import { api } from './api.js';

export const state = {
  boot: (typeof window !== 'undefined' && window.__BOOT__) || {},
  content: null,       // /api/content
  user: null,
  wallet: null,
  csrf: null,
  favorites: [],
  notifications: { rows: [], unread: 0 },
  slip: { legs: [], stake: 500, type: 'single' },
  lobby: { category: null, search: '', sort: 'curated', rows: [], total: 0, loading: true },
  crash: { state: null, history: [], connected: false },
  live: { tables: [], byKey: {} },
  sports: { fixtures: [], status: null },
  admin: { tab: 'dashboard', cache: {} },
  session: { authenticated: false, startedAt: Date.now(), realityCheckShown: false },
  errors: [],
};

const subs = new Set();
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function emit(what = 'any') {
  for (const fn of subs) {
    try { fn(what, state); } catch (err) { console.error('[store]', err); }
  }
}
export function patch(part, what = 'any') {
  Object.assign(state, part);
  emit(what);
  return state;
}

export const isAuthed = () => !!state.user;
export const isStaff = () => ['admin', 'moderator'].includes(state.user?.role);
export const isAdmin = () => state.user?.role === 'admin';

export async function refreshSession() {
  try {
    const data = await api.get('/auth/session');
    patch({
      user: data?.authenticated ? data.user : null,
      wallet: data?.wallet ?? null,
      csrf: data?.csrf ?? null,
      session: { ...state.session, authenticated: !!data?.authenticated, startedAt: Date.now() },
    }, 'session');
    if (data?.authenticated && data.csrf) api.setCsrf(data.csrf);
    return data;
  } catch (err) {
    patch({ user: null, wallet: null }, 'session');
    throw err;
  }
}

export async function refreshWallet() {
  if (!state.user) return null;
  try {
    const w = await api.get('/wallet');
    patch({ wallet: w }, 'wallet');
    return w;
  } catch { return state.wallet; }
}

export async function refreshContent() {
  const content = await api.get('/content');
  patch({ content }, 'content');
  return content;
}

export async function refreshNotifications() {
  if (!state.user) return;
  try {
    const n = await api.get('/notifications?limit=20');
    patch({ notifications: n }, 'notifications');
  } catch { /* keep last known */ }
}

export async function refreshFavorites() {
  if (!state.user) return;
  try {
    const f = await api.get('/favorites');
    patch({ favorites: f.keys || [] }, 'favorites');
  } catch { /* ignore */ }
}

export function toggleFavoriteLocal(key, on) {
  const set = new Set(state.favorites);
  if (on) set.add(key); else set.delete(key);
  patch({ favorites: [...set] }, 'favorites');
}

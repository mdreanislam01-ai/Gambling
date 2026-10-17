/**
 * Live channel. Uses EventSource when available; everything else falls back to
 * polling so the UI still updates behind proxies that buffer SSE.
 */
import { state, patch } from './state.js';
import { api } from './api.js';

const handlers = new Map();
let source = null;
let poller = null;
let attempt = 0;

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => handlers.get(event)?.delete(fn);
}

function dispatch(event, payload) {
  for (const fn of handlers.get(event) || []) {
    try { fn(payload, event); } catch (err) { console.error(`[sse ${event}]`, err); }
  }
  for (const fn of handlers.get('*') || []) {
    try { fn(payload, event); } catch { /* ignore */ }
  }
}

export function connectLive() {
  if (typeof window === 'undefined') return;
  if (!('EventSource' in window)) { startPolling(4000); return; }
  disconnect();
  try {
    source = new EventSource('/api/events', { withCredentials: true });
  } catch {
    startPolling(4000);
    return;
  }
  source.onopen = () => {
    attempt = 0;
    patch({ live: { ...state.live, connected: true } }, 'live:status');
    stopPolling();
  };
  source.onmessage = (ev) => {
    if (!ev.data) return;
    let parsed;
    try { parsed = JSON.parse(ev.data); } catch { return; }
    dispatch(ev.lastEventId || 'message', parsed);
  };
  source.onerror = () => {
    patch({ live: { ...state.live, connected: false } }, 'live:status');
    if (source) { source.close(); source = null; }
    attempt += 1;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
    setTimeout(connectLive, wait);
    startPolling(Math.max(2500, wait));
  };
  // Named events are forwarded by the hub as `event: name\ndata: json`.
  const names = ['hello', 'crash:tick', 'crash:betting', 'crash:flying', 'crash:crashed', 'crash:cashout', 'crash:bet', 'crash:lost',
    'live:round', 'live:phase', 'sports:update', 'sports:bet', 'sports:settled', 'notification', 'bet:settled', 'bet:opened', 'wallet:update'];
  for (const name of names) {
    source.addEventListener(name, (ev) => {
      let parsed = null;
      try { parsed = JSON.parse(ev.data); } catch { parsed = { raw: ev.data }; }
      dispatch(name, parsed);
    });
  }
}

export function disconnect() {
  if (source) { try { source.close(); } catch { /* noop */ } source = null; }
  stopPolling();
}

let lastTick = 0;
async function pollOnce() {
  if (Date.now() - lastTick < 1200) return;
  lastTick = Date.now();
  try {
    const [crash, tables] = await Promise.all([api.get('/crash').catch(() => null), api.get('/live/tables').catch(() => null)]);
    if (crash) dispatch('crash:tick', crash);
    if (tables) dispatch('live:poll', tables);
  } catch { /* offline */ }
}

function startPolling(ms = 4000) {
  if (poller) return;
  poller = setInterval(pollOnce, ms);
  pollOnce();
}
function stopPolling() {
  if (poller) clearInterval(poller);
  poller = null;
}

export const isLiveConnected = () => !!source && source.readyState === 1;
export { startPolling };

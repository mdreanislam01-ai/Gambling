import { SseHub } from '../lib/http.js';

/** Single SSE channel: crash rounds, live tables, sports ticks, notifications. */
export const hub = new SseHub('live');

export function broadcast(event, data, { user = null } = {}) {
  hub.send(event, data);
}

export function bindSse(ctx) {
  const client = hub.add(ctx.res);
  ctx.res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, t: Date.now(), clients: hub.size })}\n\n`);
  const ping = setInterval(() => {
    try { ctx.res.write(`: ping ${Date.now()}\n\n`); } catch { /* closed */ }
  }, 25000);
  ping.unref?.();
  const cleanup = () => {
    clearInterval(ping);
    hub.remove(client);
  };
  ctx.req.on('close', cleanup);
  ctx.res.on('error', cleanup);
  return client;
}

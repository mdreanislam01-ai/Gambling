import { SseHub } from '../lib/http.js';

/** Single SSE channel: crash rounds, live tables, sports ticks, notifications. */
export const hub = new SseHub('live');

/**
 * @param opts.user  user id or user object — when set, only that user's open
 *                   connections receive the event (per-user privacy, not filtering).
 */
export function broadcast(event, data, { user = null, userId = null } = {}) {
  const target = userId ?? (user && typeof user === 'object' ? user.id : user) ?? null;
  hub.send(event, data, { userId: target });
}

export function bindSse(ctx) {
  const client = hub.add(ctx.res, { userId: ctx.user?.id ?? null });
  ctx.res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, t: Date.now(), clients: hub.size })}\n\n`);
  const ping = setInterval(() => {
    try { ctx.res.write(`: ping ${Date.now()}\n\n`); } catch { /* closed */ }
  }, 25000);
  ping.unref?.();
  const cleanup = () => {
    clearInterval(ping);
    hub.remove(client);
  };
  // Node closes the *request* stream as soon as a bodyless GET is parsed, so
  // listening on req would drop every subscriber right after the hello frame.
  // The response connection is the real lifecycle signal for SSE.
  if (ctx.res.writable) ctx.res.on('close', cleanup);
  else ctx.req.on('aborted', cleanup);
  ctx.res.on('error', cleanup);
  return client;
}

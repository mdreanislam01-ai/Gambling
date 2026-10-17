import { HttpError } from '../lib/http.js';
import { get, all, run } from '../db/index.js';
import { clamp } from '../lib/util.js';
import config from '../config.js';
import * as users from '../services/users.js';
import { setLimits, selfExclude } from '../services/users.js';
import { listNotifications, markRead, unreadCount, clearNotifications, notifyUser } from '../services/notify.js';
import { netLossToday, wageredThisWeek, walletSummary } from '../services/wallet.js';
import { setting } from '../services/settings.js';
import { audit, sendMail } from '../services/audit.js';
import { listUserBets } from '../services/bets.js';

export function registerAccountRoutes(route) {
  route('GET', '/api/notifications', { auth: true }, (ctx) => ({
    rows: listNotifications(ctx.user.id, { limit: clamp(Number(ctx.query.limit) || 30, 1, 100), unreadOnly: ctx.query.unread === '1' }),
    unread: unreadCount(ctx.user.id),
  }));

  route('POST', '/api/notifications/read', { auth: true }, (ctx) => {
    const changed = markRead(ctx.user.id, ctx.body?.id ?? 'all');
    return { changed, unread: unreadCount(ctx.user.id) };
  });

  route('DELETE', '/api/notifications', { auth: true }, (ctx) => ({ removed: clearNotifications(ctx.user.id) }));

  route('GET', '/api/rg/status', { auth: true }, (ctx) => {
    const u = get(`SELECT * FROM users WHERE id = :id`, { id: ctx.user.id });
    const loss = netLossToday(ctx.user.id);
    const week = wageredThisWeek(ctx.user.id);
    const sessionStart = Date.parse(String(ctx.session.sessionCreatedAt).replace(' ', 'T') + 'Z');
    const sessionMinutes = Math.floor((Date.now() - sessionStart) / 60000);
    return {
      limits: {
        dailyLoss: u.daily_loss_limit ?? null,
        weeklyWager: u.weekly_wager_limit ?? null,
        sessionMinutes: u.session_limit_min ?? null,
        realityCheckEveryMin: Number(setting('reality_check_every_min', config.rg.realityCheckEveryMin)),
      },
      usage: {
        todayNetLoss: loss,
        todayLossRemaining: u.daily_loss_limit ? Math.max(0, u.daily_loss_limit - loss) : null,
        weekWagered: week,
        weekRemaining: u.weekly_wager_limit ? Math.max(0, u.weekly_wager_limit - week) : null,
        sessionMinutes,
        sessionRemaining: u.session_limit_min ? Math.max(0, u.session_limit_min - sessionMinutes) : null,
      },
      selfExclusionUntil: u.self_exclusion_until,
      realityCheck: !!u.reality_check,
      currency: config.demo.currency,
      helpKey: 'rg.help_note',
    };
  });

  route('POST', '/api/rg/limits', { auth: true, limit: 'write' }, (ctx) => ({
    ...setLimits(ctx.user.id, ctx.body || {}),
    status: { todayNetLoss: netLossToday(ctx.user.id) },
  }));

  route('POST', '/api/rg/self-exclude', { auth: true, limit: 'write' }, (ctx) => {
    const out = selfExclude(ctx.user.id, ctx.body?.hours);
    audit({ actorId: ctx.user.id, action: 'rg.self_exclusion_api', entity: 'user', entityId: ctx.user.id, meta: { hours: ctx.body?.hours } });
    return out;
  });

  route('GET', '/api/tickets', { auth: true }, (ctx) => ({
    rows: all(`SELECT id, ref, category, subject, status, priority, created_at AS createdAt, updated_at AS updatedAt
               FROM support_tickets WHERE user_id = :u ORDER BY id DESC LIMIT 30`, { u: ctx.user.id }),
  }));

  route('POST', '/api/tickets', { auth: true, limit: 'write' }, (ctx) => {
    const subject = String(ctx.body?.subject || '').trim().slice(0, 120);
    const body = String(ctx.body?.body || '').trim().slice(0, 4000);
    const category = ['general', 'account', 'limits', 'technical', 'responsible_gaming', 'other'].includes(ctx.body?.category) ? ctx.body.category : 'general';
    if (subject.length < 4) throw new HttpError(422, 'val.failed', { errors: [{ field: 'subject', code: 'val.too_short', min: 4 }] });
    if (body.length < 12) throw new HttpError(422, 'val.failed', { errors: [{ field: 'body', code: 'val.too_short', min: 12 }] });
    const ref = `AP-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    run(
      `INSERT INTO support_tickets(ref, user_id, category, subject, priority) VALUES(:ref,:u,:c,:s,:p)`,
      { ref, u: ctx.user.id, c: category, s: subject, p: category === 'responsible_gaming' ? 'urgent' : 'normal' }
    );
    const ticket = get(`SELECT id FROM support_tickets WHERE ref = :r`, { r: ref });
    run(`INSERT INTO ticket_messages(ticket_id, author_user_id, from_admin, body) VALUES(:t,:a,0,:b)`, { t: ticket.id, a: ctx.user.id, b: body });
    notifyUser(ctx.user.id, { titleKey: 'notif.ticket_created', bodyKey: 'notif.ticket_created_body', params: { ref }, level: 'info', icon: 'chat', link: `/support/${ref}` });
    if (config.admin.seedEmail) {
      sendMail({ to: config.admin.seedEmail, subject: `[support] ${ref} — ${subject}`, body: body, kind: 'support' });
    }
    return { ref, id: ticket.id, status: 'open' };
  });

  route('GET', '/api/tickets/:ref', { auth: true }, (ctx) => {
    const t = get(`SELECT * FROM support_tickets WHERE ref = :r AND (user_id = :u OR :staff = 1)`, { r: ctx.params.ref, u: ctx.user.id, staff: ['admin', 'moderator'].includes(ctx.user.role) ? 1 : 0 });
    if (!t) throw new HttpError(404, 'err.ticket_not_found');
    return {
      ticket: { id: t.id, ref: t.ref, category: t.category, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at },
      messages: all(`SELECT m.id, m.body, m.from_admin AS fromAdmin, m.created_at AS createdAt, u.username AS author
                     FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_user_id WHERE m.ticket_id = :t ORDER BY m.id`, { t: t.id }),
    };
  });

  route('POST', '/api/tickets/:ref/reply', { auth: true, limit: 'write' }, (ctx) => {
    const body = String(ctx.body?.body || '').trim().slice(0, 4000);
    if (body.length < 3) throw new HttpError(422, 'val.too_short');
    const t = get(`SELECT * FROM support_tickets WHERE ref = :r AND user_id = :u`, { r: ctx.params.ref, u: ctx.user.id });
    if (!t) throw new HttpError(404, 'err.ticket_not_found');
    if (t.status === 'closed') throw new HttpError(409, 'err.ticket_closed');
    run(`INSERT INTO ticket_messages(ticket_id, author_user_id, from_admin, body) VALUES(:t,:a,0,:b)`, { t: t.id, a: ctx.user.id, b: body });
    run(`UPDATE support_tickets SET status = 'open', updated_at = datetime('now') WHERE id = :id`, { id: t.id });
    return { ok: true };
  });

  route('POST', '/api/tickets/:ref/close', { auth: true }, (ctx) => {
    const r = run(`UPDATE support_tickets SET status = 'closed', updated_at = datetime('now') WHERE ref = :r AND user_id = :u`, { r: ctx.params.ref, u: ctx.user.id });
    if (!r.changes) throw new HttpError(404, 'err.ticket_not_found');
    return { ok: true };
  });

  route('GET', '/api/account/activity', { auth: true }, (ctx) => {
    const bets = listUserBets(ctx.user.id, { limit: 12 });
    return {
      bets: bets.rows,
      wallet: walletSummary(ctx.user.id),
      unread: unreadCount(ctx.user.id),
    };
  });
}

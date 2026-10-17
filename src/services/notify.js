import { all, get, run } from '../db/index.js';
import { broadcast } from './events.js';

export function notifyUser(userId, { titleKey, bodyKey = null, params = null, level = 'info', icon = null, link = null }) {
  const r = run(
    `INSERT INTO notifications(user_id, level, icon, title_key, body_key, params, link)
     VALUES(:u,:level,:icon,:titleKey,:bodyKey,:params,:link)`,
    { u: userId, level, icon, titleKey, bodyKey, params: params ? JSON.stringify(params) : null, link }
  );
  const id = Number(r.lastInsertRowid);
  broadcast('notification', { id, userId, titleKey, bodyKey, params, level, icon, link });
  return id;
}

export function listNotifications(userId, { limit = 30, unreadOnly = false } = {}) {
  const p = { u: userId, limit: Math.min(100, Math.max(1, limit)) };
  let where = 'user_id = :u';
  if (unreadOnly) where += ' AND read_at IS NULL';
  return all(`SELECT id, level, icon, title_key AS titleKey, body_key AS bodyKey, params, link, read_at AS readAt, created_at AS createdAt
              FROM notifications WHERE ${where} ORDER BY id DESC LIMIT :limit`, p)
    .map((n) => ({ ...n, params: n.params ? JSON.parse(n.params) : null }));
}

export const unreadCount = (userId) =>
  get(`SELECT COUNT(*) c FROM notifications WHERE user_id = :u AND read_at IS NULL`, { u: userId })?.c ?? 0;

export function markRead(userId, id = null) {
  if (id === null || id === 'all') return run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = :u AND read_at IS NULL`, { u: userId }).changes;
  return run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = :u AND id = :id`, { u: userId, id }).changes;
}

export function clearNotifications(userId) {
  return run(`DELETE FROM notifications WHERE user_id = :u`, { u: userId }).changes;
}

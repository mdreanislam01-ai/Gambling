import { run, get, all } from '../db/index.js';
import { hashIp } from '../lib/security.js';
import { json } from '../lib/util.js';

export function audit({ actorId = null, actorRole = 'system', action, entity = null, entityId = null, meta = null, ip = null }) {
  run(
    `INSERT INTO audit_logs(actor_id, actor_role, action, entity, entity_id, meta, ip_hash)
     VALUES(:actorId,:actorRole,:action,:entity,:entityId,:meta,:ip)`,
    { actorId, actorRole, action, entity, entityId: entityId === null ? null : String(entityId), meta: meta ? JSON.stringify(meta) : null, ip: ip ? hashIp(ip) : null }
  );
}

export function listAudit({ limit = 100, offset = 0, action = null, actorId = null } = {}) {
  const where = [];
  const p = { limit: Math.min(500, Math.max(1, limit)), offset: Math.max(0, offset) };
  if (action) { where.push('a.action LIKE :action'); p.action = `%${action}%`; }
  if (actorId) { where.push('a.actor_id = :actorId'); p.actorId = actorId; }
  const sql = `SELECT a.*, u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT :limit OFFSET :offset`;
  return all(sql, p).map((r) => ({ ...r, meta: json(r.meta) }));
}

export const auditCount = () => get(`SELECT COUNT(*) c FROM audit_logs`)?.c ?? 0;

/** Error monitoring: deduplicated by code so a flood does not fill the table. */
export function logError({ code, message, stack, path, userId = null, meta = null, level = 'error' }) {
  const msg = String(message || 'unknown').slice(0, 900);
  const existing = get(`SELECT id, occurrences FROM error_logs WHERE code = :code AND resolved = 0 ORDER BY id DESC LIMIT 1`, { code: code || msg.slice(0, 40) });
  if (existing) {
    run(`UPDATE error_logs SET occurrences = occurrences + 1, last_seen_at = datetime('now'), message = :m WHERE id = :id`, { m: msg, id: existing.id });
    return existing.id;
  }
  const r = run(
    `INSERT INTO error_logs(level, code, message, stack, path, user_id, meta)
     VALUES(:level,:code,:message,:stack,:path,:userId,:meta)`,
    { level, code: code || null, message: msg, stack: stack ? String(stack).slice(0, 2000) : null, path: path || null, userId, meta: meta ? JSON.stringify(meta).slice(0, 2000) : null }
  );
  return Number(r.lastInsertRowid);
}

export function listErrors({ limit = 50, unresolvedOnly = true } = {}) {
  return all(
    `SELECT e.*, u.email AS user_email FROM error_logs e LEFT JOIN users u ON u.id = e.user_id
     ${unresolvedOnly ? 'WHERE e.resolved = 0' : ''} ORDER BY e.id DESC LIMIT :limit`,
    { limit: Math.min(200, Math.max(1, limit)) }
  ).map((r) => ({ ...r, meta: json(r.meta) }));
}

export function resolveError(id) {
  run(`UPDATE error_logs SET resolved = 1 WHERE id = :id`, { id });
}

/**
 * DEMO MAILBOX. There is no SMTP in this build: outbound mail is stored in the
 * `outbox` table and shown on /demo-mailbox so password reset & verification
 * links are real and testable rather than faked. Point SMTP_URL at a provider
 * (see docs/DEPLOYMENT.md) to send for real.
 */
export function sendMail({ to, subject, body, link, kind = 'generic' }) {
  const r = run(
    `INSERT INTO outbox(to_email, subject, body, link, kind) VALUES(:to,:subject,:body,:link,:kind)`,
    { to, subject: String(subject).slice(0, 200), body: String(body).slice(0, 4000), link: link ? String(link).slice(0, 400) : null, kind }
  );
  return Number(r.lastInsertRowid);
}

export function listMail({ limit = 50, email = null } = {}) {
  return all(
    `SELECT id, to_email, subject, body, link, kind, delivered, created_at FROM outbox
     ${email ? 'WHERE to_email = :email' : ''} ORDER BY id DESC LIMIT :limit`,
    { limit: Math.min(200, Math.max(1, limit)), email }
  );
}

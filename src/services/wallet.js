import { get, run, all, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import config from '../config.js';
import { setting } from './settings.js';
import { centsToText } from '../lib/util.js';

export function ensureWallet(userId) {
  run(`INSERT INTO user_wallets(user_id) VALUES(:u) ON CONFLICT(user_id) DO NOTHING`, { u: userId });
  return get(`SELECT * FROM user_wallets WHERE user_id = :u`, { u: userId });
}

export const walletOf = (userId) => get(`SELECT * FROM user_wallets WHERE user_id = :u`, { u: userId });

export function transactions(userId, { limit = 50, offset = 0, kind = null } = {}) {
  const p = { u: userId, limit: Math.min(200, Math.max(1, limit)), offset: Math.max(0, offset) };
  let where = 'user_id = :u';
  if (kind) { where += ' AND kind = :kind'; p.kind = kind; }
  return all(`SELECT id, kind, amount, balance_after, reference, note_key, note, created_at FROM transactions WHERE ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`, p);
}

export function transactionCount(userId) {
  return get(`SELECT COUNT(*) c FROM transactions WHERE user_id = :u`, { u: userId })?.c ?? 0;
}

/** Ledger write. Must be called inside an open transaction. */
export function postTransaction({ userId, kind, amount, reference = null, noteKey = null, note = null, balanceAfter = null }) {
  const bal = balanceAfter ?? get(`SELECT balance FROM user_wallets WHERE user_id = :u`, { u: userId })?.balance ?? 0;
  run(
    `INSERT INTO transactions(user_id, kind, amount, balance_after, reference, note_key, note)
     VALUES(:u,:kind,:amount,:bal,:ref,:noteKey,:note)`,
    { u: userId, kind, amount: Math.round(amount), bal: Math.round(bal), ref: reference, noteKey, note }
  );
  return bal;
}

export function debit({ userId, amount, reference, noteKey, note }) {
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, 'err.stake_invalid');
  ensureWallet(userId);
  const w = walletOf(userId);
  if (w.balance < amt) throw new HttpError(400, 'err.insufficient_balance', { need: amt, have: w.balance });
  const after = w.balance - amt;
  run(`UPDATE user_wallets SET balance = :b, lifetime_wagered = lifetime_wagered + :amt, version = version + 1, updated_at = datetime('now') WHERE user_id = :u`, { b: after, amt, u: userId });
  postTransaction({ userId, kind: 'bet', amount: -amt, reference, noteKey, note, balanceAfter: after });
  return after;
}

export function credit({ userId, amount, kind = 'payout', reference, noteKey, note, capCheck = true }) {
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt === 0) return walletOf(userId)?.balance ?? 0;
  ensureWallet(userId);
  const w = walletOf(userId);
  let after = Math.max(0, w.balance + amt);
  const cap = Number(setting('max_balance_cents', config.demo.maxBalanceCents));
  if (capCheck && amt > 0 && cap > 0 && after > cap) after = cap;
  const wonDelta = kind === 'payout' ? amt : 0;
  run(
    `UPDATE user_wallets SET balance = :b, lifetime_won = lifetime_won + :won, version = version + 1, updated_at = datetime('now') WHERE user_id = :u`,
    { b: after, won: wonDelta, u: userId }
  );
  postTransaction({ userId, kind, amount: amt, reference, noteKey, note, balanceAfter: after });
  return after;
}

export function grantSignupBonus(userId) {
  const bonus = Number(setting('signup_bonus_cents', config.demo.signupBonusCents));
  if (!bonus || bonus <= 0) return 0;
  const w = ensureWallet(userId);
  if (w.bonus_granted) return 0;
  tx(() => {
    credit({ userId, amount: bonus, kind: 'bonus', noteKey: 'wallet.note.signup_bonus', reference: `signup:${userId}` });
    run(`UPDATE user_wallets SET bonus_granted = 1 WHERE user_id = :u`, { u: userId });
  });
  return bonus;
}

/** Daily demo top-up so a test account never becomes unusable. */
export function dailyResetBonus(userId) {
  if (setting('demo_daily_bonus') !== '1') return 0;
  const last = get(`SELECT created_at FROM transactions WHERE user_id = :u AND kind = 'daily_reset' ORDER BY id DESC LIMIT 1`, { u: userId });
  const day = new Date().toISOString().slice(0, 10);
  if (last && String(last.created_at).slice(0, 10) === day) return 0;
  const w = ensureWallet(userId);
  if (w.balance > 5000) return 0;
  const amount = Number(setting('signup_bonus_cents', config.demo.signupBonusCents));
  tx(() => credit({ userId, amount, kind: 'daily_reset', noteKey: 'wallet.note.daily_reset', reference: `daily:${day}` }));
  return amount;
}

/** Whether the daily demo top-up is available, and why not (used by /api/wallet). */
export function dailyBonusStatus(userId) {
  const amount = Number(setting('signup_bonus_cents', config.demo.signupBonusCents));
  if (setting('demo_daily_bonus') !== '1') return { available: false, amount: 0, reason: 'disabled' };
  const last = get(`SELECT created_at FROM transactions WHERE user_id = :u AND kind = 'daily_reset' ORDER BY id DESC LIMIT 1`, { u: userId });
  const day = new Date().toISOString().slice(0, 10);
  if (last && String(last.created_at).slice(0, 10) === day) return { available: false, amount, reason: 'claimed_today' };
  const w = ensureWallet(userId);
  if (w.balance > 5000) return { available: false, amount, reason: 'balance_high', balance: w.balance };
  return { available: true, amount };
}

export function netLossToday(userId) {
  const row = get(
    `SELECT COALESCE(SUM(stake - payout), 0) AS loss FROM bets
     WHERE user_id = :u AND status != 'pending' AND date(COALESCE(settled_at, created_at)) = date('now')`,
    { u: userId }
  );
  return Math.max(0, row?.loss ?? 0);
}

export function wageredThisWeek(userId) {
  return get(
    `SELECT COALESCE(SUM(stake), 0) AS s FROM bets WHERE user_id = :u AND created_at >= datetime('now','-7 days')`,
    { u: userId }
  )?.s ?? 0;
}

export const walletSummary = (userId) => {
  const w = ensureWallet(userId);
  return {
    balance: w.balance,
    lifetimeWagered: w.lifetime_wagered,
    lifetimeWon: w.lifetime_won,
    netResult: w.lifetime_won - w.lifetime_wagered,
    currency: config.demo.currency,
    updatedAt: w.updated_at,
  };
};

export const formatDemo = (cents, locale = 'en') => `${centsToText(cents, locale)}`;

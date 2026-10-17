import crypto from 'node:crypto';
import { get, run, all, tx } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import { sha256 } from '../lib/security.js';
import { crashPoint, multiplierAt, timeForMultiplier } from '../games/crash.js';
import { json } from '../lib/util.js';
import { broadcast } from './events.js';
import { debit, credit } from './wallet.js';
import { openBetRow, settleBetTx, recordDay } from './bets.js';
import { notifyUser } from './notify.js';
import { setting } from './settings.js';

const GAME_KEY = 'rocket-crash';

/**
 * Server-authoritative crash rounds. The crash point is computed *before*
 * betting opens and its hash is broadcast, so it cannot be changed mid-flight.
 */
export class CrashEngine {
  constructor({ gameKey = GAME_KEY, tickMs = 200 } = {}) {
    this.gameKey = gameKey;
    this.tickMs = tickMs;
    this.round = null;
    this.queue = [];
    this.timer = null;
    this.running = false;
    this.history = [];
  }

  get growth() { return Number(setting('crash_growth', 0.09)) || 0.09; }
  get edge() { return Number(setting('house_edge_bps', 100)) || 100; }
  get bettingMs() { return Number(setting('crash_betting_ms', 8000)) || 8000; }
  get gapMs() { return Number(setting('crash_gap_ms', 3000)) || 3000; }

  start() {
    if (this.running) return;
    this.running = true;
    this.recover();
    this.openBetting('startup');
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.refundAll('engine_stopped');
  }

  /** Anything left over from a previous process is refunded, never silently lost. */
  recover() {
    const orphans = all(`SELECT * FROM bets WHERE status = 'pending' AND kind = 'casino' AND game_key = :g`, { g: this.gameKey });
    if (!orphans.length) return 0;
    for (const b of orphans) {
      try {
        tx(() => {
          credit({ userId: b.user_id, amount: b.stake, kind: 'refund', reference: b.public_id, noteKey: 'wallet.note.refund' });
          settleBetTx({ betId: b.id, status: 'void', payout: b.stake, outcome: { recovered: true }, state: null });
        });
        notifyUser(b.user_id, { titleKey: 'notif.crash_recovered', bodyKey: 'notif.crash_recovered_body', params: { bet: b.public_id }, level: 'info', link: '/account/history' });
      } catch (err) {
        import('./audit.js').then((m) => m.logError({ code: 'crash.recover_failed', message: err.message, meta: { bet: b.public_id } }));
      }
    }
    return orphans.length;
  }

  refundAll(reason) {
    const participants = this.round ? [...this.round.participants.values()] : [];
    const queued = this.queue.slice();
    this.queue = [];
    if (this.round) this.round.participants.clear();
    for (const entry of [...participants, ...queued]) {
      if (entry.settled) continue;
      try {
        tx(() => {
          credit({ userId: entry.userId, amount: entry.stake, kind: 'refund', reference: entry.betPublicId, noteKey: 'wallet.note.refund' });
          const bet = get(`SELECT id FROM bets WHERE public_id = :p`, { p: entry.betPublicId });
          if (bet) settleBetTx({ betId: bet.id, status: 'void', payout: entry.stake, outcome: { refunded: true, reason }, state: null });
        });
      } catch { /* best effort */ }
    }
  }

  openBetting(trigger = 'loop') {
    const serverSeed = crypto.randomBytes(16).toString('hex');
    const hash = sha256(serverSeed);
    const prevNonce = Number(get(`SELECT COALESCE(MAX(id),0) v FROM game_rounds WHERE game_key = :g`, { g: this.gameKey })?.v ?? 0);
    const clientSeed = crypto.randomBytes(4).toString('hex');
    const point = Math.max(1, crashPoint(serverSeed, clientSeed, prevNonce + 1, this.edge));
    const r = run(
      `INSERT INTO game_rounds(game_key, status, server_seed, server_seed_hash, client_seed, nonce, result, meta)
       VALUES(:g,'betting',:s,:h,:c,:n,NULL,:meta)`,
      { g: this.gameKey, s: serverSeed, h: hash, c: clientSeed, n: prevNonce + 1, meta: JSON.stringify({ trigger, participants: 0 }) }
    );
    this.round = {
      id: Number(r.lastInsertRowid),
      status: 'betting',
      serverSeed,
      serverSeedHash: hash,
      clientSeed,
      nonce: prevNonce + 1,
      crashPointValue: point,
      participants: new Map(),
      startedAt: Date.now(),
      phaseEndsAt: Date.now() + this.bettingMs,
      multiplier: 1,
      elapsed: 0,
      trigger,
    };
    // Move queued bets into the round.
    while (this.queue.length) {
      const entry = this.queue.shift();
      this.attach(entry);
    }
    this.persist();
    this.emit('crash:betting');
  }

  attach({ userId, betId, betPublicId, stake, autoCashout }) {
    const key = `${userId}:${betPublicId}`;
    this.round.participants.set(key, { key, userId, betId, betPublicId, stake, autoCashout: autoCashout || null, cashedAt: null, settled: false, joinedAt: Date.now() });
    run(`UPDATE bets SET round_id = :r WHERE id = :b`, { r: this.round.id, b: betId });
    this.emit('crash:bet');
  }

  emit(event) {
    broadcast(event, this.snapshot());
  }

  /** Other players are shown as anonymised seats — never as emails or ids. */
  mask(userId) {
    return `Player ${(Number(userId) * 7919 + (this.round?.id ?? 0) * 31) % 9000 + 1000}`;
  }

  snapshot({ includeUser = null } = {}) {
    if (!this.round) return { status: 'idle' };
    const list = [...this.round.participants.values()].filter((p) => (includeUser ? true : true)).map((p) => ({
      userId: includeUser === p.userId ? p.userId : undefined,
      masked: this.mask(p.userId),
      stake: p.stake,
      cashedAt: p.cashedAt,
      payout: p.cashedAt ? Math.floor(p.stake * p.cashedAt) : null,
      auto: p.autoCashout,
    }));
    return {
      roundId: this.round.id,
      status: this.round.status,
      serverSeedHash: this.round.serverSeedHash,
      nonce: this.round.nonce,
      startedAt: this.round.startedAt,
      phaseEndsAt: this.round.phaseEndsAt,
      multiplier: this.round.multiplier,
      crashPoint: this.round.status === 'crashed' ? this.round.crashPointValue : null,
      revealedSeed: this.round.status === 'crashed' ? this.round.serverSeed : null,
      participants: list,
      participantCount: list.length,
      totalStaked: list.reduce((a, p) => a + p.stake, 0),
      queued: this.queue.length,
      growth: this.growth,
    };
  }

  persist() {
    if (!this.round) return;
    run(
      `UPDATE game_rounds SET status = :s, result = :res, started_at = COALESCE(started_at, datetime('now')),
        ended_at = CASE WHEN :s = 'ended' THEN datetime('now') ELSE ended_at END,
        meta = :meta WHERE id = :id`,
      {
        s: this.round.status === 'crashed' ? 'ended' : this.round.status,
        res: this.round.status === 'crashed' ? JSON.stringify({ multiplier: this.round.crashPointValue, revealed: this.round.serverSeed }) : null,
        meta: JSON.stringify({ participants: this.round.participants.size, trigger: this.round.trigger }),
        id: this.round.id,
      }
    );
  }

  tick() {
    if (!this.running || !this.round) return;
    const now = Date.now();
    try {
      if (this.round.status === 'betting') {
        if (now >= this.round.phaseEndsAt) {
          this.round.status = 'flying';
          this.round.flyStart = now;
          this.round.phaseEndsAt = now + Math.round(timeForMultiplier(this.round.crashPointValue, this.growth) * 1000);
          this.persist();
          this.emit('crash:flying');
        } else {
          this.emit('crash:tick');
        }
        return;
      }
      if (this.round.status === 'flying') {
        const elapsed = (now - this.round.flyStart) / 1000;
        const m = multiplierAt(elapsed, this.growth);
        this.round.elapsed = elapsed;
        this.round.multiplier = m;
        // auto-cashout
        for (const p of this.round.participants.values()) {
          if (!p.settled && p.autoCashout && m >= p.autoCashout) this.cashOut(p, p.autoCashout, 'auto');
        }
        if (m >= this.round.crashPointValue) { this.crash(); return; }
        this.emit('crash:tick');
        return;
      }
      if (this.round.status === 'crashed' && now >= this.round.phaseEndsAt) this.openBetting('loop');
    } catch (err) {
      import('./audit.js').then((m) => m.logError({ code: 'crash.tick', message: err.message, stack: err.stack }));
    }
  }

  cashOut(participant, requested, mode = 'manual') {
    const current = this.round.multiplier;
    const accepted = Math.min(requested && mode === 'manual' ? Math.min(requested, current) : requested, current);
    if (accepted <= 1) throw new HttpError(400, 'crash.cashout_invalid');
    const payout = Math.floor(participant.stake * accepted);
    participant.cashedAt = accepted;
    participant.settled = true;
    // settleBetTx() credits the payout itself — never credit twice.
    tx(() => {
      settleBetTx({ betId: participant.betId, status: 'cashout', payout, multiplier: accepted, outcome: { cashedAt: accepted, mode, roundId: this.round.id } });
    });
    if (accepted >= 20) {
      notifyUser(participant.userId, { titleKey: 'notif.big_win', bodyKey: 'notif.big_win_body', params: { multiplier: accepted, amount: payout, game: 'Rocket Crash' }, level: 'success', icon: 'trophy', link: '/account/history' });
    }
    broadcast('crash:cashout', { bet: participant.betPublicId, multiplier: accepted, payout, mode });
    return { multiplier: accepted, payout };
  }

  crash() {
    const r = this.round;
    r.status = 'crashed';
    r.multiplier = r.crashPointValue;
    r.phaseEndsAt = Date.now() + this.gapMs;
    const lost = [];
    tx(() => {
      for (const p of r.participants.values()) {
        if (p.settled) continue;
        p.settled = true;
        settleBetTx({ betId: p.betId, status: 'lost', payout: 0, multiplier: 0, outcome: { crashPoint: r.crashPointValue, roundId: r.id, cashed: false } });
        lost.push(p.userId);
      }
    });
    this.persist();
    this.emit('crash:crashed');
    if (lost.length) broadcast('crash:lost', { count: lost.length, crashPoint: r.crashPointValue });
  }

  /** Player action: join the current betting phase (or queue for the next). */
  join({ user, game, stake, selection }) {
    if (!this.round) throw new HttpError(503, 'crash.engine_off');
    const auto = Number(selection?.autoCashout);
    const autoCashout = Number.isFinite(auto) && auto > 1 ? Math.min(1000, Math.max(1.01, auto)) : null;
    return tx(() => {
      const fair = { serverSeedHash: this.round.serverSeedHash, nonce: this.round.nonce, clientSeed: this.round.clientSeed, seedId: null };
      debit({ userId: user.id, amount: stake, noteKey: 'wallet.note.stake' });
      const row = openBetRow({
        userId: user.id, kind: 'casino', gameKey: game.key, stake,
        selection: { autoCashout },
        autoCashout,
        fair: { ...fair, serverSeed: null },
        view: { roundId: this.round.id, status: this.round.status },
      });
      recordDay({ wagered: stake, paid: 0 });
      const entry = { userId: user.id, betId: row.id, betPublicId: row.public_id, stake, autoCashout, settled: false };
      if (this.round.status === 'betting') {
        this.attach(entry);
        run(`UPDATE bets SET round_id = :r WHERE id = :b`, { r: this.round.id, b: row.id });
        return { bet: { ...rowLike(row) }, pending: true, queued: false, round: { id: this.round.id, status: this.round.status, hash: this.round.serverSeedHash, endsAt: this.round.phaseEndsAt } };
      }
      this.queue.push(entry);
      return { bet: { ...rowLike(row) }, pending: true, queued: true, round: { id: this.round.id, status: this.round.status, hash: this.round.serverSeedHash, endsAt: this.round.phaseEndsAt } };
    });
  }

  cashout(user, betPublicId, requested) {
    if (!this.round || this.round.status !== 'flying') throw new HttpError(409, 'crash.round_not_live');
    const entry = [...this.round.participants.values()].find((p) => p.userId === user.id && p.betPublicId === betPublicId);
    if (!entry) {
      // could still be queued for the next round → cancel it
      const idx = this.queue.findIndex((q) => q.userId === user.id && q.betPublicId === betPublicId);
      if (idx === -1) throw new HttpError(404, 'err.bet_not_found');
      const [q] = this.queue.splice(idx, 1);
      tx(() => {
        credit({ userId: user.id, amount: q.stake, kind: 'refund', reference: q.betPublicId, noteKey: 'wallet.note.refund' });
        settleBetTx({ betId: q.betId, status: 'void', payout: q.stake, outcome: { cancelled: 'before_round' }, state: null });
      });
      return { cancelled: true, refunded: q.stake };
    }
    if (entry.settled) throw new HttpError(409, 'crash.already_cashed');
    return this.cashOut(entry, Number(requested) > 0 ? Math.min(Number(requested), this.round.multiplier) : this.round.multiplier, 'manual');
  }
}

const rowLike = (row) => ({
  id: row.public_id, gameKey: row.game_key, stake: row.stake, payout: row.payout,
  status: row.status, createdAt: row.created_at, selection: json(row.selection, {}),
});

export const crashEngine = new CrashEngine();

export function crashPublicState(user) {
  return crashEngine.snapshot({ includeUser: user?.id ?? null });
}

export function roundHistory(limit = 24) {
  return all(
    `SELECT id, status, server_seed_hash, server_seed, client_seed, nonce, result, started_at, ended_at, meta
     FROM game_rounds WHERE game_key = :g AND status = 'ended' ORDER BY id DESC LIMIT :l`,
    { g: GAME_KEY, l: Math.min(100, Math.max(1, limit)) }
  ).map((r) => {
    const result = json(r.result, {});
    return {
      id: r.id,
      multiplier: result.multiplier ?? null,
      serverSeedHash: r.server_seed_hash,
      serverSeed: r.server_seed,
      clientSeed: r.client_seed,
      nonce: r.nonce,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      verifiable: verifyRound({ seed: r.server_seed, clientSeed: r.client_seed, nonce: r.nonce, reported: result.multiplier }),
    };
  });
}

export function verifyRound({ seed, clientSeed, nonce, reported }) {
  if (!seed) return { ok: false, reason: 'seed_not_revealed' };
  const recomputed = crashPoint(seed, clientSeed, nonce, crashEngine.edge);
  return { ok: Math.abs(recomputed - Number(reported)) < 0.005, recomputed, reported: Number(reported), hashMatches: sha256(seed) };
}

export const CRASH_GAME_KEY = GAME_KEY;

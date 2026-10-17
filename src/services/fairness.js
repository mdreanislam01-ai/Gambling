import { get, run, all, tx } from '../db/index.js';
import crypto from 'node:crypto';
import { sha256 } from '../lib/security.js';
import { json } from '../lib/util.js';
import { Rng } from '../games/rng.js';

/**
 * Per-user provably-fair chain.
 *  - A player always sees SHA-256(server_seed) *before* betting.
 *  - Outcome = engine(Rng(`server_seed|nonce|client_seed`)).
 *  - Rotating the seed reveals the old one, so every past bet stays verifiable.
 */
export const seedKeyFor = (serverSeed, nonce, clientSeed) => `${serverSeed}|${nonce || 0}|${clientSeed || 'player'}`;

export function currentSeed(userId) {
  const row = get(`SELECT * FROM fairness_seeds WHERE user_id = :u AND revealed = 0 ORDER BY id DESC LIMIT 1`, { u: userId });
  if (row) return row;
  const serverSeed = crypto.randomBytes(16).toString('hex');
  const r = run(`INSERT INTO fairness_seeds(user_id, server_seed, server_seed_hash, client_seed) VALUES(:u,:s,:h,'player')`, {
    u: userId, s: serverSeed, h: sha256(serverSeed),
  });
  return get(`SELECT * FROM fairness_seeds WHERE id = :id`, { id: Number(r.lastInsertRowid) });
}

export function setClientSeed(userId, clientSeed) {
  const seed = String(clientSeed ?? '').trim().slice(0, 48) || 'player';
  const cur = currentSeed(userId);
  run(`UPDATE fairness_seeds SET client_seed = :s WHERE id = :id`, { s: seed, id: cur.id });
  return { clientSeed: seed };
}

/** Reveal the active seed (it becomes independently verifiable) and open a new one. */
export function rotateSeed(userId) {
  const cur = currentSeed(userId);
  const serverSeed = crypto.randomBytes(16).toString('hex');
  tx(() => {
    run(`UPDATE fairness_seeds SET revealed = 1, rotated_at = datetime('now') WHERE id = :id`, { id: cur.id });
    run(`INSERT INTO fairness_seeds(user_id, server_seed, server_seed_hash, client_seed, nonce) VALUES(:u,:s,:h,:c,0)`, {
      u: userId, s: serverSeed, h: sha256(serverSeed), c: cur.client_seed,
    });
  });
  return seedView(userId);
}

export function seedView(userId) {
  const cur = currentSeed(userId);
  return {
    seedId: cur.id,
    serverSeedHash: cur.server_seed_hash,
    clientSeed: cur.client_seed,
    nonce: cur.nonce,
    revealed: false,
    createdAt: cur.created_at,
  };
}

export function historySeeds(userId, limit = 20) {
  return all(
    `SELECT id, server_seed, server_seed_hash, client_seed, nonce, revealed, created_at, rotated_at
     FROM fairness_seeds WHERE user_id = :u ORDER BY id DESC LIMIT :l`,
    { u: userId, l: Math.min(100, Math.max(1, limit)) }
  );
}

/** Commit the nonce that the next bet will consume (inside the bet transaction). */
export function nextNonce(userId) {
  const cur = currentSeed(userId);
  const nonce = cur.nonce + 1;
  run(`UPDATE fairness_seeds SET nonce = :n WHERE id = :id`, { n: nonce, id: cur.id });
  return {
    seedId: cur.id,
    serverSeed: cur.server_seed,
    serverSeedHash: cur.server_seed_hash,
    clientSeed: cur.client_seed,
    nonce,
  };
}

export const rngFor = (serverSeed, nonce, clientSeed) => new Rng(seedKeyFor(serverSeed, nonce, clientSeed));

/**
 * Recompute a settled instant bet from its seeds. Used by /api/fairness/verify,
 * the /fairness page and the automated tests.
 */
export async function verifyBet(betPublicId) {
  const bet = get(`SELECT b.*, g.engine FROM bets b LEFT JOIN games g ON g.key = b.game_key WHERE b.public_id = :p`, { p: betPublicId });
  if (!bet) return { ok: false, reason: 'not_found' };
  if (!bet.server_seed_hash || bet.nonce === null) return { ok: false, reason: 'not_fair', gameKey: bet.game_key };
  const seedRow = get(`SELECT * FROM fairness_seeds WHERE id = :id`, { id: bet.seed_id ?? -1 }) ||
    get(`SELECT * FROM fairness_seeds WHERE user_id = :u AND server_seed_hash = :h`, { u: bet.user_id, h: bet.server_seed_hash });
  if (!seedRow) return { ok: false, reason: 'seed_not_revealed', expectedHash: bet.server_seed_hash };
  if (!seedRow.server_seed || !seedRow.revealed) return { ok: false, reason: 'seed_not_revealed', expectedHash: bet.server_seed_hash, note: 'reveal the seed on /fairness to verify bets made with it' };
  const { ENGINES } = await import('../games/index.js');
  const engine = ENGINES[bet.engine];
  if (!engine?.run) return { ok: false, reason: 'engine_round_based', gameKey: bet.game_key };
  const game = get(`SELECT * FROM games WHERE key = :k`, { k: bet.game_key }) || { engine: bet.engine, config: '{}', house_edge_bps: 100 };
  let recomputed;
  try {
    recomputed = engine.run({
      stake: bet.stake,
      selection: json(bet.selection, {}),
      game: { ...game, config: json(game.config, {}) },
      rng: rngFor(seedRow.server_seed, bet.nonce, bet.client_seed || seedRow.client_seed),
    });
  } catch (err) {
    return { ok: false, reason: 'recompute_failed', detail: String(err.message).slice(0, 160) };
  }
  return {
    ok: recomputed?.payout === bet.payout,
    reason: recomputed?.payout === bet.payout ? 'verified' : 'mismatch',
    hashMatches: sha256(seedRow.server_seed) === bet.server_seed_hash,
    serverSeed: seedRow.server_seed,
    clientSeed: bet.client_seed || seedRow.client_seed,
    nonce: bet.nonce,
    recomputed: { payout: recomputed?.payout, status: recomputed?.status, multiplier: recomputed?.multiplier, outcome: recomputed?.outcome },
    stored: { payout: bet.payout, status: bet.status, multiplier: bet.multiplier, outcome: json(bet.outcome, {}) },
  };
}

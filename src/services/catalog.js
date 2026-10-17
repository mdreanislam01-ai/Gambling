import { all, get, run } from '../db/index.js';
import { json } from '../lib/util.js';
import { HttpError } from '../lib/http.js';

export const CATEGORIES = [
  { key: 'slots', nameKey: 'cat.slots' },
  { key: 'live', nameKey: 'cat.live' },
  { key: 'table', nameKey: 'cat.table' },
  { key: 'cards', nameKey: 'cat.cards' },
  { key: 'crash', nameKey: 'cat.crash' },
  { key: 'arcade', nameKey: 'cat.arcade' },
  { key: 'new', nameKey: 'cat.new' },
  { key: 'popular', nameKey: 'cat.popular' },
  { key: 'favorites', nameKey: 'cat.favorites' },
];

const shape = (row, { includeConfig = false } = {}) => {
  if (!row) return null;
  const out = {
    key: row.key,
    name: row.name,
    nameKey: row.name_key,
    category: row.category,
    provider: row.provider,
    descriptionKey: row.description_key,
    minBet: row.min_bet,
    maxBet: row.max_bet,
    rtpBps: row.rtp_bps,
    houseEdgeBps: row.house_edge_bps,
    volatility: row.volatility,
    layout: row.layout,
    engine: row.engine,
    enabled: !!row.enabled,
    visibility: row.visibility,
    isNew: !!row.is_new,
    featured: !!row.featured,
    popularity: row.popularity,
    plays: row.plays,
    tags: json(row.tags, []),
    accent: row.accent,
    multiStep: ['blackjack', 'video_poker', 'mines'].includes(row.engine),
    updatedAt: row.updated_at,
  };
  if (includeConfig) out.config = json(row.config, {});
  return out;
};

/**
 * Shared WHERE builder for the lobby. listGames() and countGames() use the same
 * predicates, so the "N games" label can never disagree with the rows shown.
 */
function gameFilter({ category = null, search = null, userId = null, visibility = 'public', includeHidden = false } = {}) {
  const where = [];
  const p = {};
  if (!includeHidden) {
    where.push(visibility === 'public' ? `g.visibility = 'public'` : `g.visibility IN ('public','logged_in')`);
    where.push('g.enabled = 1');
  }
  if (category && category !== 'popular' && category !== 'new' && category !== 'favorites') {
    where.push('g.category = :category');
    p.category = category;
  }
  if (category === 'new') where.push('g.is_new = 1');
  if (category === 'popular') where.push('g.popularity > 0');
  if (search) {
    // User text is escaped so a literal "%" or "_" cannot match the whole table.
    const like = `%${escapeLike(String(search).slice(0, 60))}%`;
    where.push(`(g.name LIKE :q ESCAPE '\\' OR g.key LIKE :q ESCAPE '\\' OR g.tags LIKE :q ESCAPE '\\' OR g.category LIKE :q ESCAPE '\\' OR g.name_key LIKE :q ESCAPE '\\')`);
    p.q = like;
  }
  if (category === 'favorites' && userId) {
    where.push(`EXISTS (SELECT 1 FROM favorites f WHERE f.game_key = g.key AND f.user_id = :userId)`);
    p.userId = userId;
  } else if (category === 'favorites') {
    where.push('1 = 0');
  }
  return { where, p };
}

const escapeLike = (v) => v.replace(/[\\%_]/g, (c) => '\\' + c);

export function listGames({ category = null, search = null, userId = null, visibility = 'public', sort = 'curated', limit = 200, offset = 0, includeHidden = false } = {}) {
  const { where, p: filters } = gameFilter({ category, search, userId, visibility, includeHidden });
  const p = { ...filters, limit: Math.min(500, Math.max(1, limit)), offset: Math.max(0, offset) };
  const order = sort === 'newest' ? 'g.is_new DESC, g.sort ASC' : sort === 'popular' ? 'g.popularity DESC, g.plays DESC' : sort === 'az' ? 'g.name ASC' : 'g.featured DESC, g.sort ASC';
  const rows = all(
    `SELECT g.*${userId ? ', (SELECT 1 FROM favorites f WHERE f.game_key = g.key AND f.user_id = :fu) AS fav' : ''}
     FROM games g ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    { ...p, fu: userId ?? 0 }
  );
  return rows.map((r) => ({ ...shape(r), favorite: !!r.fav }));
}

export function countGames(opts = {}) {
  const { where, p } = gameFilter(opts);
  const sql = `SELECT COUNT(*) c FROM games g${where.length ? ' WHERE ' + where.join(' AND ') : ''}`;
  return get(sql, Object.keys(p).length ? p : undefined)?.c ?? 0;
}

export function getGame(key, { includeDisabled = false } = {}) {
  const row = get(`SELECT g.*${includeDisabled ? '' : ''} FROM games g WHERE g.key = :key`, { key });
  if (!row) return null;
  if (!includeDisabled && (!row.enabled || row.visibility === 'hidden')) return null;
  return shape(row, { includeConfig: true });
}

export function getRawGame(key) {
  return get(`SELECT * FROM games WHERE key = :key`, { key });
}

export function listAllGamesAdmin() {
  return all(`SELECT g.*, (SELECT COUNT(*) FROM bets b WHERE b.game_key = g.key) AS bet_count FROM games g ORDER BY g.category, g.sort, g.name`).map((r) => ({
    ...shape(r, { includeConfig: true }),
    betCount: r.bet_count,
  }));
}

export function categoriesWithCounts() {
  const rows = all(`SELECT category, COUNT(*) c FROM games WHERE enabled = 1 AND visibility != 'hidden' GROUP BY category`);
  const byKey = Object.fromEntries(rows.map((r) => [r.category, r.c]));
  const userId = null;
  return CATEGORIES.map((c) => ({
    ...c,
    count:
      c.key === 'favorites' ? 0 :
      c.key === 'popular' ? get(`SELECT COUNT(*) c FROM games WHERE enabled = 1 AND popularity > 0`)?.c ?? 0 :
      c.key === 'new' ? get(`SELECT COUNT(*) c FROM games WHERE enabled = 1 AND is_new = 1`)?.c ?? 0 :
      byKey[c.key] ?? 0,
  })).filter((c) => c.key === 'favorites' || c.count > 0);
}

export function setFavorite(userId, gameKey, on) {
  if (!get(`SELECT 1 ok FROM games WHERE key = :k`, { k: gameKey })) throw new HttpError(404, 'err.game_not_found');
  if (on) run(`INSERT INTO favorites(user_id, game_key) VALUES(:u,:g) ON CONFLICT DO NOTHING`, { u: userId, g: gameKey });
  else run(`DELETE FROM favorites WHERE user_id = :u AND game_key = :g`, { u: userId, g: gameKey });
  return { favorite: !!on, count: get(`SELECT COUNT(*) c FROM favorites WHERE user_id = :u`, { u: userId })?.c ?? 0 };
}

export const favoriteKeys = (userId) => all(`SELECT game_key FROM favorites WHERE user_id = :u`, { u: userId }).map((r) => r.game_key);

export function updateGame(key, patch) {
  const fields = [];
  const p = { key };
  const map = {
    name: 'name', nameKey: 'name_key', category: 'category', provider: 'provider', descriptionKey: 'description_key',
    minBet: 'min_bet', maxBet: 'max_bet', rtpBps: 'rtp_bps', houseEdgeBps: 'house_edge_bps', volatility: 'volatility',
    layout: 'layout', engine: 'engine', enabled: 'enabled', visibility: 'visibility', isNew: 'is_new', featured: 'featured',
    popularity: 'popularity', tags: 'tags', accent: 'accent', config: 'config', sort: 'sort',
  };
  for (const [k, col] of Object.entries(map)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'enabled' || k === 'isNew' || k === 'featured') v = v ? 1 : 0;
    if (k === 'tags' || k === 'config') v = JSON.stringify(v ?? null);
    if (['minBet', 'maxBet', 'rtpBps', 'houseEdgeBps', 'popularity', 'sort'].includes(k)) v = Math.round(Number(v) || 0);
    fields.push(`${col} = :${k}`);
    p[k] = v;
  }
  if (!fields.length) return shape(getRawGame(key), { includeConfig: true });
  run(`UPDATE games SET ${fields.join(', ')}, updated_at = datetime('now') WHERE key = :key`, p);
  return shape(getRawGame(key), { includeConfig: true });
}

export function bumpPlays(key, n = 1) {
  run(`UPDATE games SET plays = plays + :n, popularity = popularity + :n WHERE key = :k`, { n, k: key });
}

/** Live-casino tables (simulated dealers). */
export function listLiveTables({ includeClosed = false } = {}) {
  return all(
    `SELECT t.*, g.name AS game_name, g.name_key AS game_name_key, g.engine AS game_engine
     FROM live_tables t JOIN games g ON g.key = t.game_key
     ${includeClosed ? '' : "WHERE t.status != 'closed' AND t.enabled = 1 AND g.enabled = 1"}
     ORDER BY t.sort, t.name`
  ).map((r) => ({
    id: r.id,
    key: r.key,
    gameKey: r.game_key,
    name: r.name,
    nameKey: r.name_key,
    dealer: r.dealer_name,
    studio: r.studio,
    status: r.status,
    minBet: r.min_bet,
    maxBet: r.max_bet,
    seats: r.seats,
    roundSeconds: r.round_seconds,
    players: r.players,
    accent: r.accent,
    engine: r.game_engine,
  }));
}

export const getLiveTable = (key) =>
  get(`SELECT t.*, g.name AS game_name, g.engine AS game_engine FROM live_tables t JOIN games g ON g.key = t.game_key WHERE t.key = :k`, { k: key });

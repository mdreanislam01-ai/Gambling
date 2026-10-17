import { HttpError } from '../lib/http.js';
import { get, all, run, tx } from '../db/index.js';
import { clamp, json } from '../lib/util.js';
import * as stats from '../services/stats.js';
import * as catalog from '../services/catalog.js';
import { listUsers, adminUpdateUser, adminAdjustCredits, publicUser } from '../services/users.js';
import { listAudit, listErrors, resolveError, audit, listMail } from '../services/audit.js';
import { allSettings, setSetting, DEFAULTS } from '../services/settings.js';
import { listUserBets, publicBet } from '../services/bets.js';
import * as sports from '../services/sports.js';
import { notifyUser } from '../services/notify.js';
import { liveEngine } from '../services/live.js';
import { crashEngine } from '../services/crash.js';
import { transactions } from '../services/wallet.js';

const actor = (ctx) => ({ id: ctx.user.id, role: ctx.user.role });
const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

export function registerAdminRoutes(route) {
  // ---- dashboards ---------------------------------------------------------
  route('GET', '/api/admin/overview', { auth: 'staff' }, (ctx) => ({
    overview: stats.overview({ days: clamp(int(ctx.query.days, 7), 1, 365) }),
    series: stats.dailySeries(clamp(int(ctx.query.series, 14), 7, 90)),
    system: stats.systemStatus(),
  }));

  route('GET', '/api/admin/stats/games', { auth: 'staff' }, (ctx) => ({
    rows: stats.gameStats({ days: clamp(int(ctx.query.days, 30), 1, 365) }),
  }));

  route('GET', '/api/admin/stats/users', { auth: 'staff' }, (ctx) => ({
    rows: stats.topUsers({ days: clamp(int(ctx.query.days, 30), 1, 365), limit: clamp(int(ctx.query.limit, 10), 1, 50) }),
  }));

  // ---- users --------------------------------------------------------------
  route('GET', '/api/admin/users', { auth: 'staff' }, (ctx) =>
    listUsers({
      q: ctx.query.q || null,
      role: ctx.query.role || null,
      status: ctx.query.status || null,
      limit: clamp(int(ctx.query.limit, 25), 1, 100),
      offset: Math.max(0, int(ctx.query.offset, 0)),
    })
  );

  route('GET', '/api/admin/users/:id', { auth: 'staff' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const u = get(`SELECT u.*, w.balance, w.lifetime_wagered, w.lifetime_won FROM users u LEFT JOIN user_wallets w ON w.user_id = u.id WHERE u.id = :id`, { id });
    if (!u) throw new HttpError(404, 'err.user_not_found');
    return {
      user: publicUser(u),
      wallet: { balance: u.balance, lifetimeWagered: u.lifetime_wagered, lifetimeWon: u.lifetime_won },
      bets: listUserBets(id, { limit: 15 }).rows,
      transactions: transactions(id, { limit: 15 }),
      sessions: all(`SELECT id, created_at AS createdAt, last_seen_at AS lastSeenAt, user_agent AS userAgent FROM sessions WHERE user_id = :id ORDER BY created_at DESC LIMIT 10`, { id }).map((s) => ({ ...s, id: `${String(s.id).slice(0, 8)}…` })),
      audit: listAudit({ limit: 25, actorId: id }),
      tickets: all(`SELECT id, ref, subject, status, priority, created_at AS createdAt FROM support_tickets WHERE user_id = :id ORDER BY id DESC LIMIT 10`, { id }),
    };
  });

  route('PATCH', '/api/admin/users/:id', { auth: 'admin' }, (ctx) => ({
    user: adminUpdateUser(actor(ctx), int(ctx.params.id, 0), ctx.body || {}, ctx.ip),
  }));

  route('POST', '/api/admin/users/:id/credits', { auth: 'admin' }, (ctx) =>
    adminAdjustCredits(actor(ctx), int(ctx.params.id, 0), { amount: int(ctx.body?.amountCents ?? ctx.body?.amount, 0), reason: ctx.body?.reason }, ctx.ip)
  );

  route('POST', '/api/admin/users/:id/notify', { auth: 'staff' }, (ctx) => {
    const titleKey = String(ctx.body?.titleKey || 'notif.admin_message');
    notifyUser(int(ctx.params.id, 0), { titleKey, bodyKey: ctx.body?.bodyKey || null, params: ctx.body?.params || null, level: ctx.body?.level || 'info', link: ctx.body?.link || null });
    audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'admin.user_notified', entity: 'user', entityId: ctx.params.id, meta: { titleKey } });
    return { ok: true };
  });

  // ---- catalogue ----------------------------------------------------------
  route('GET', '/api/admin/games', { auth: 'staff' }, () => ({ rows: catalog.listAllGamesAdmin() }));

  route('PATCH', '/api/admin/games/:key', { auth: 'admin' }, (ctx) => {
    const out = catalog.updateGame(ctx.params.key, ctx.body || {});
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.game_updated', entity: 'game', entityId: ctx.params.key, meta: ctx.body, ip: ctx.ip });
    return { game: out };
  });

  route('POST', '/api/admin/games', { auth: 'admin' }, (ctx) => {
    const b = ctx.body || {};
    const key = String(b.key || '').toLowerCase().replace(/[^a-z0-9_]/g, '-').slice(0, 40);
    if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(key)) throw new HttpError(422, 'val.key_invalid');
    if (get(`SELECT 1 ok FROM games WHERE key = :k`, { k: key })) throw new HttpError(409, 'err.game_exists');
    const engine = ['slots','roulette','dice','mines','wheel','plinko','bingo','blackjack','baccarat','three_patti','video_poker','crash','live'].includes(b.engine) ? b.engine : 'slots';
    run(
      `INSERT INTO games(key, name, name_key, category, engine, description_key, min_bet, max_bet, rtp_bps, house_edge_bps, volatility,
                          layout, enabled, visibility, is_new, featured, popularity, tags, accent, config, sort)
       VALUES(:key,:name,:nk,:cat,:engine,:dk,:min,:max,:rtp,:edge,:vol,:layout,:enabled,:vis,:new,:feat,0,:tags,:accent,:cfg,:sort)`,
      {
        key, name: String(b.name || key).slice(0, 60), nk: String(b.nameKey || `game.${key}`).slice(0, 60),
        cat: ['slots','live','table','cards','crash','arcade'].includes(b.category) ? b.category : 'slots',
        engine, dk: b.descriptionKey || null, min: clamp(int(b.minBet, 100), 10, 100000), max: clamp(int(b.maxBet, 500000), 100, 20000000),
        rtp: clamp(int(b.rtpBps, 9600), 5000, 10000), edge: clamp(int(b.houseEdgeBps, 200), 0, 2000),
        vol: ['low','medium','high'].includes(b.volatility) ? b.volatility : 'medium',
        layout: ['card','wide','hero','live'].includes(b.layout) ? b.layout : 'card',
        enabled: b.enabled === false ? 0 : 1, vis: ['public','logged_in','hidden'].includes(b.visibility) ? b.visibility : 'public',
        new: b.isNew ? 1 : 0, feat: b.featured ? 1 : 0,
        tags: JSON.stringify(b.tags || []), accent: String(b.accent || 'gold').slice(0, 24),
        cfg: JSON.stringify(b.config || {}), sort: int(b.sort, 100),
      }
    );
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.game_created', entity: 'game', entityId: key, meta: { engine }, ip: ctx.ip });
    return { game: catalog.updateGame(key, {}) };
  });

  route('GET', '/api/admin/live-tables', { auth: 'staff' }, () => ({
    rows: all(`SELECT t.*, g.engine AS engine, g.enabled AS game_enabled FROM live_tables t JOIN games g ON g.key = t.game_key ORDER BY t.sort`),
    enginesRunning: { live: liveEngine.running, crash: crashEngine.running },
  }));

  route('PATCH', '/api/admin/live-tables/:id', { auth: 'admin' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const fields = [];
    const p = { id };
    for (const [k, col] of Object.entries({ dealerName: 'dealer_name', status: 'status', minBet: 'min_bet', maxBet: 'max_bet', roundSeconds: 'round_seconds', enabled: 'enabled', name: 'name', studio: 'studio', sort: 'sort' })) {
      if (ctx.body?.[k] === undefined) continue;
      let v = ctx.body[k];
      if (k === 'enabled') v = v ? 1 : 0;
      if (['minBet', 'maxBet', 'roundSeconds', 'sort'].includes(k)) v = clamp(int(v, 0), 0, 600);
      if (k === 'status' && !['open', 'paused', 'closed'].includes(v)) throw new HttpError(422, 'val.enum', { field: 'status' });
      fields.push(`${col} = :${k}`);
      p[k] = v;
    }
    if (!fields.length) throw new HttpError(422, 'val.no_fields');
    run(`UPDATE live_tables SET ${fields.join(', ')} WHERE id = :id`, p);
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.live_table_updated', entity: 'live_table', entityId: id, meta: ctx.body, ip: ctx.ip });
    liveEngine.reload();
    return { ok: true };
  });

  // ---- content: banners + announcements -----------------------------------
  const contentRow = (r) => ({
    id: r.id, title: r.title_en, subtitle: r.subtitle_en, cta: r.cta_en,
    titleBn: r.title_bn, subtitleBn: r.subtitle_bn, ctaBn: r.cta_bn,
    badge: r.badge, target: r.target, media: r.media, accent: r.accent, sort: r.sort,
    active: !!r.active, startsAt: r.starts_at, endsAt: r.ends_at, clicks: r.clicks, createdAt: r.created_at,
    type: r.type, link: r.link, body: r.body_en, bodyBn: r.body_bn,
  });

  route('GET', '/api/admin/banners', { auth: 'staff' }, () => ({ rows: all(`SELECT * FROM banners ORDER BY sort, id DESC`).map(contentRow) }));

  const bannerCols = {
    titleEn: 'title_en', subtitleEn: 'subtitle_en', ctaEn: 'cta_en', titleBn: 'title_bn',
    subtitleBn: 'subtitle_bn', ctaBn: 'cta_bn', badge: 'badge', target: 'target', media: 'media', accent: 'accent',
  };

  route('POST', '/api/admin/banners', { auth: 'admin' }, (ctx) => {
    const b = ctx.body || {};
    if (!String(b.titleEn || '').trim()) throw new HttpError(422, 'val.failed', { errors: [{ field: 'titleEn', code: 'val.required' }] });
    const r = run(
      `INSERT INTO banners(title_en, subtitle_en, cta_en, title_bn, subtitle_bn, cta_bn, badge, target, media, accent, sort, active, starts_at, ends_at)
       VALUES(:title_en,:subtitle_en,:cta_en,:title_bn,:subtitle_bn,:cta_bn,:badge,:target,:media,:accent,:sort,:active,:starts_at,:ends_at)`,
      {
        title_en: String(b.titleEn).slice(0, 120), subtitle_en: String(b.subtitleEn || '').slice(0, 240), cta_en: String(b.ctaEn || '').slice(0, 60),
        title_bn: String(b.titleBn || '').slice(0, 120) || null, subtitle_bn: String(b.subtitleBn || '').slice(0, 240) || null,
        cta_bn: String(b.ctaBn || '').slice(0, 60) || null,
        badge: String(b.badge || '').slice(0, 30) || null, target: String(b.target || '').slice(0, 120) || null,
        media: String(b.media || '').slice(0, 60) || null, accent: String(b.accent || 'gold').slice(0, 24),
        sort: int(b.sort, 100), active: b.active === false ? 0 : 1,
        starts_at: b.startsAt || null, ends_at: b.endsAt || null,
      }
    );
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.banner_created', entity: 'banner', entityId: Number(r.lastInsertRowid), ip: ctx.ip });
    return { banner: contentRow(get(`SELECT * FROM banners WHERE id = :id`, { id: Number(r.lastInsertRowid) })) };
  });

  route('PATCH', '/api/admin/banners/:id', { auth: 'admin' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const fields = [];
    const p = { id };
    for (const [k, col] of Object.entries({ ...bannerCols, sort: 'sort', active: 'active', startsAt: 'starts_at', endsAt: 'ends_at' })) {
      if (ctx.body?.[k] === undefined) continue;
      let v = ctx.body[k];
      if (k === 'active') v = v ? 1 : 0;
      if (['sort'].includes(k)) v = int(v, 100);
      if (typeof v === 'string') v = v.slice(0, 240) || null;
      fields.push(`${col} = :${k}`);
      p[k] = v;
    }
    if (!fields.length) throw new HttpError(422, 'val.no_fields');
    run(`UPDATE banners SET ${fields.join(', ')} WHERE id = :id`, p);
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.banner_updated', entity: 'banner', entityId: id, meta: ctx.body, ip: ctx.ip });
    return { banner: contentRow(get(`SELECT * FROM banners WHERE id = :id`, { id })) };
  });

  route('DELETE', '/api/admin/banners/:id', { auth: 'admin' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    if (!get(`SELECT 1 ok FROM banners WHERE id = :id`, { id })) throw new HttpError(404, 'err.not_found');
    run(`DELETE FROM banners WHERE id = :id`, { id });
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.banner_deleted', entity: 'banner', entityId: id, ip: ctx.ip });
    return { ok: true };
  });

  route('GET', '/api/admin/announcements', { auth: 'staff' }, () => ({ rows: all(`SELECT * FROM announcements ORDER BY id DESC LIMIT 50`).map(contentRow) }));

  route('POST', '/api/admin/announcements', { auth: 'admin' }, (ctx) => {
    const b = ctx.body || {};
    if (!String(b.titleEn || '').trim() || !String(b.bodyEn || '').trim()) throw new HttpError(422, 'val.failed', { errors: [{ field: 'titleEn', code: 'val.required' }, { field: 'bodyEn', code: 'val.required' }].filter((e) => !String(b[e.field]).trim()) });
    const r = run(
      `INSERT INTO announcements(title_en, body_en, title_bn, body_bn, type, link, active, starts_at, ends_at, created_by)
       VALUES(:te,:be,:tb,:bb,:type,:link,:active,:sa,:ea,:cb)`,
      {
        te: String(b.titleEn).slice(0, 160), be: String(b.bodyEn).slice(0, 2000),
        tb: String(b.titleBn || '').slice(0, 160) || null, bb: String(b.bodyBn || '').slice(0, 2000) || null,
        type: ['info','bonus','maintenance','tournament','warn'].includes(b.type) ? b.type : 'info',
        link: String(b.link || '').slice(0, 120) || null, active: b.active === false ? 0 : 1,
        sa: b.startsAt || null, ea: b.endsAt || null, cb: ctx.user.id,
      }
    );
    const id = Number(r.lastInsertRowid);
    if (b.pushToUsers) {
      const targets = all(`SELECT id FROM users WHERE status = 'active' AND notify_push = 1 ORDER BY id DESC LIMIT 5000`);
      tx(() => { for (const t of targets) notifyUser(t.id, { titleKey: 'notif.announcement', bodyKey: null, params: { id, title: String(b.titleEn).slice(0, 80) }, level: 'info', icon: 'megaphone', link: b.link || '/announcements' }); });
    }
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.announcement_created', entity: 'announcement', entityId: id, meta: { type: b.type, pushed: !!b.pushToUsers }, ip: ctx.ip });
    return { announcement: contentRow(get(`SELECT * FROM announcements WHERE id = :id`, { id })) };
  });

  route('PATCH', '/api/admin/announcements/:id', { auth: 'admin' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const fields = [];
    const p = { id };
    for (const [k, col] of Object.entries({ titleEn: 'title_en', bodyEn: 'body_en', titleBn: 'title_bn', bodyBn: 'body_bn', type: 'type', link: 'link', active: 'active', startsAt: 'starts_at', endsAt: 'ends_at' })) {
      if (ctx.body?.[k] === undefined) continue;
      let v = ctx.body[k];
      if (k === 'active') v = v ? 1 : 0;
      if (typeof v === 'string') v = v.slice(0, 2000);
      fields.push(`${col} = :${k}`);
      p[k] = v;
    }
    if (!fields.length) throw new HttpError(422, 'val.no_fields');
    run(`UPDATE announcements SET ${fields.join(', ')} WHERE id = :id`, p);
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.announcement_updated', entity: 'announcement', entityId: id, meta: ctx.body, ip: ctx.ip });
    return { announcement: contentRow(get(`SELECT * FROM announcements WHERE id = :id`, { id })) };
  });

  route('DELETE', '/api/admin/announcements/:id', { auth: 'admin' }, (ctx) => {
    run(`DELETE FROM announcements WHERE id = :id`, { id: int(ctx.params.id, 0) });
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.announcement_deleted', entity: 'announcement', entityId: ctx.params.id, ip: ctx.ip });
    return { ok: true };
  });

  // ---- bets / transactions ------------------------------------------------
  route('GET', '/api/admin/bets', { auth: 'staff' }, (ctx) => {
    const p = { limit: clamp(int(ctx.query.limit, 40), 1, 200), offset: Math.max(0, int(ctx.query.offset, 0)) };
    const where = ['1=1'];
    if (ctx.query.userId) { where.push('b.user_id = :userId'); p.userId = int(ctx.query.userId, 0); }
    if (ctx.query.status) { where.push('b.status = :status'); p.status = ctx.query.status; }
    if (ctx.query.game) { where.push('b.game_key = :game'); p.game = ctx.query.game; }
    if (ctx.query.kind) { where.push('b.kind = :kind'); p.kind = ctx.query.kind; }
    const rows = all(
      `SELECT b.*, u.username, u.email FROM bets b JOIN users u ON u.id = b.user_id
       WHERE ${where.join(' AND ')} ORDER BY b.id DESC LIMIT :limit OFFSET :offset`, p
    );
    return {
      rows: rows.map((r) => ({ ...publicBet(r), username: r.username, email: r.email, userId: r.user_id })),
      total: get(`SELECT COUNT(*) c FROM bets b WHERE ${where.join(' AND ')}`, p)?.c ?? 0,
    };
  });

  route('GET', '/api/admin/transactions', { auth: 'staff' }, (ctx) => ({
    rows: all(
      `SELECT t.*, u.username FROM transactions t JOIN users u ON u.id = t.user_id
       WHERE 1=1 ${ctx.query.userId ? 'AND t.user_id = :u' : ''} ${ctx.query.kind ? 'AND t.kind = :k' : ''}
       ORDER BY t.id DESC LIMIT :l OFFSET :o`,
      { u: ctx.query.userId || 0, k: ctx.query.kind || null, l: clamp(int(ctx.query.limit, 40), 1, 200), o: Math.max(0, int(ctx.query.offset, 0)) }
    ),
  }));

  // ---- settings -----------------------------------------------------------
  route('GET', '/api/admin/settings', { auth: 'admin' }, () => allSettings());

  route('POST', '/api/admin/settings', { auth: 'admin' }, (ctx) => {
    const patch = ctx.body?.settings ?? ctx.body ?? {};
    const allowed = new Set([...Object.keys(DEFAULTS), ...Object.keys(allSettings().stored)]);
    const changed = {};
    tx(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!allowed.has(k)) throw new HttpError(422, 'admin.setting_unknown', { key: k });
        if (k === 'bets_enabled' || k === 'registration_open' || k === 'live_enabled' || k === 'sports_enabled' || k === 'maintenance_mode') {
          if (!['0', '1', 'true', 'false', true, false].includes(v)) throw new HttpError(422, 'val.enum', { field: k });
        }
        setSetting(k, v);
        changed[k] = v;
      }
      audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.settings_updated', entity: 'settings', meta: changed, ip: ctx.ip });
    });
    return { changed, effective: allSettings().effective };
  });

  route('POST', '/api/admin/maintenance', { auth: 'admin' }, (ctx) => {
    const on = !!ctx.body?.on;
    setSetting('maintenance_mode', on);
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: on ? 'admin.maintenance_on' : 'admin.maintenance_off', entity: 'settings', ip: ctx.ip });
    return { maintenanceMode: on };
  });

  // ---- logs, errors, mailbox ---------------------------------------------
  route('GET', '/api/admin/audit', { auth: 'admin' }, (ctx) => ({
    rows: listAudit({ limit: clamp(int(ctx.query.limit, 60), 1, 200), offset: Math.max(0, int(ctx.query.offset, 0)), action: ctx.query.action || null, actorId: ctx.query.actorId ? int(ctx.query.actorId, 0) : null }),
    total: audit === undefined ? 0 : get(`SELECT COUNT(*) c FROM audit_logs`)?.c ?? 0,
  }));

  route('GET', '/api/admin/errors', { auth: 'admin' }, (ctx) => ({
    rows: listErrors({ limit: clamp(int(ctx.query.limit, 40), 1, 200), unresolvedOnly: ctx.query.all !== '1' }),
  }));

  route('POST', '/api/admin/errors/:id/resolve', { auth: 'admin' }, (ctx) => {
    resolveError(int(ctx.params.id, 0));
    return { ok: true };
  });

  route('GET', '/api/admin/mailbox', { auth: 'admin' }, (ctx) => ({ rows: listMail({ limit: clamp(int(ctx.query.limit, 40), 1, 100), email: ctx.query.email || null }) }));

  // ---- sports -------------------------------------------------------------
  route('GET', '/api/admin/sports/fixtures', { auth: 'staff' }, (ctx) =>
    sports.adminListFixtures({
      status: ctx.query.status || null,
      sport: ctx.query.sport || null,
      q: ctx.query.q || null,
      limit: clamp(int(ctx.query.limit, 40), 1, 100),
      offset: Math.max(0, int(ctx.query.offset, 0)),
    })
  );

  route('PATCH', '/api/admin/sports/fixtures/:id', { auth: 'admin' }, (ctx) => ({
    fixture: sports.updateFixture(actor(ctx), ctx.params.id, ctx.body || {}, ctx.ip),
  }));

  route('POST', '/api/admin/sports/fixtures/:id/settle', { auth: 'admin' }, (ctx) => {
    const out = sports.settleFixture(int(ctx.params.id, 0), { source: 'admin' });
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.fixture_settled', entity: 'fixture', entityId: ctx.params.id, meta: out, ip: ctx.ip });
    return out;
  });

  route('POST', '/api/admin/sports/fixtures/:id/markets/suspend', { auth: 'admin' }, (ctx) => {
    sports.suspendMarkets(int(ctx.params.id, 0), ctx.body?.suspended !== false);
    return { ok: true };
  });

  route('POST', '/api/admin/sports/fixtures', { auth: 'admin' }, (ctx) => {
    const b = ctx.body || {};
    const kickoff = String(b.kickoff || '').replace('T', ' ').slice(0, 19);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(kickoff)) throw new HttpError(422, 'val.failed', { errors: [{ field: 'kickoff', code: 'val.datetime' }] });
    if (!b.home || !b.away) throw new HttpError(422, 'val.failed', { errors: [{ field: 'home', code: 'val.required' }, { field: 'away', code: 'val.required' }] });
    return tx(() => {
      const sport = b.sport === 'cricket' ? 'cricket' : 'football';
      const leagueId = int(b.leagueId, 0) || null;
      const team = (name) => {
        const found = get(`SELECT id FROM sports_teams WHERE name = :n AND sport = :s`, { n: String(name).slice(0, 60), s: sport });
        if (found) return found.id;
        const r = run(`INSERT INTO sports_teams(league_id, name, short, sport) VALUES(:l,:n,:s,:sp)`, {
          l: leagueId, n: String(name).slice(0, 60), s: String(name).replace(/[^A-Za-zА-Яа-я\u0980-\u09FF]/g, '').slice(0, 3).toUpperCase() || 'TBD', sp: sport,
        });
        return Number(r.lastInsertRowid);
      };
      const homeId = team(b.home);
      const awayId = team(b.away);
      const r = run(
        `INSERT INTO sports_fixtures(league_id, sport, home_team_id, away_team_id, kickoff, status, source, live_sim, venue, round, season)
         VALUES(:l,:sp,:h,:a,:k,'scheduled','demo',:sim,:v,:ro,:se)`,
        { l: leagueId, sp: sport, h: homeId, a: awayId, k: kickoff, sim: b.liveSim === false ? 0 : 1, v: String(b.venue || '').slice(0, 80) || null, ro: String(b.round || '').slice(0, 40) || null, se: String(b.season || '2026').slice(0, 20) }
      );
      const id = Number(r.lastInsertRowid);
      sports.buildMarketsFor(get(`SELECT * FROM sports_fixtures WHERE id = :id`, { id }));
      audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.fixture_created', entity: 'fixture', entityId: id, ip: ctx.ip });
      return { fixture: sports.getFixture(id) };
    });
  });

  route('PATCH', '/api/admin/sports/selections/:id', { auth: 'admin' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const odds = Math.round(Number(ctx.body?.oddsBps ?? (ctx.body?.odds ? Number(ctx.body.odds) * 10000 : NaN)));
    if (!Number.isFinite(odds) || odds < 10100 || odds > 1000000) throw new HttpError(422, 'val.odds_range');
    const sel = get(`SELECT s.*, m.status AS mstatus FROM sports_selections s JOIN sports_markets m ON m.id = s.market_id WHERE s.id = :id`, { id });
    if (!sel) throw new HttpError(404, 'sports.selection_not_found');
    if (sel.mstatus === 'settled') throw new HttpError(409, 'sports.market_settled');
    run(`UPDATE sports_selections SET odds_bps = :o WHERE id = :id`, { o: odds, id });
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.odds_updated', entity: 'selection', entityId: id, meta: { from: sel.odds_bps, to: odds }, ip: ctx.ip });
    return { ok: true, id, oddsBps: odds };
  });

  // ---- support ------------------------------------------------------------
  route('GET', '/api/admin/tickets', { auth: 'staff' }, (ctx) => ({
    rows: all(
      `SELECT t.*, u.username, u.email, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS msg_count
       FROM support_tickets t JOIN users u ON u.id = t.user_id
       ${ctx.query.status && ctx.query.status !== 'all' ? 'WHERE t.status = :status' : ''}
       ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT :l`,
      { status: ctx.query.status || null, l: clamp(int(ctx.query.limit, 40), 1, 100) }
    ),
  }));

  route('POST', '/api/admin/tickets/:id/reply', { auth: 'staff' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const body = String(ctx.body?.body || '').trim().slice(0, 4000);
    if (body.length < 3) throw new HttpError(422, 'val.too_short');
    const t = get(`SELECT * FROM support_tickets WHERE id = :id`, { id });
    if (!t) throw new HttpError(404, 'err.ticket_not_found');
    tx(() => {
      run(`INSERT INTO ticket_messages(ticket_id, author_user_id, from_admin, body) VALUES(:t,:a,1,:b)`, { t: id, a: ctx.user.id, b: body });
      run(`UPDATE support_tickets SET status = 'answered', updated_at = datetime('now') WHERE id = :id`, { id });
      notifyUser(t.user_id, { titleKey: 'notif.ticket_reply', bodyKey: 'notif.ticket_reply_body', params: { ref: t.ref }, level: 'info', icon: 'chat', link: `/support/${t.ref}` });
    });
    audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'admin.ticket_reply', entity: 'ticket', entityId: id, ip: ctx.ip });
    return { ok: true };
  });

  route('PATCH', '/api/admin/tickets/:id', { auth: 'staff' }, (ctx) => {
    const id = int(ctx.params.id, 0);
    const fields = [];
    const p = { id };
    if (ctx.body?.status) {
      if (!['open', 'answered', 'in_progress', 'closed'].includes(ctx.body.status)) throw new HttpError(422, 'val.enum', { field: 'status' });
      fields.push('status = :status'); p.status = ctx.body.status;
    }
    if (ctx.body?.priority) {
      if (!['low', 'normal', 'high', 'urgent'].includes(ctx.body.priority)) throw new HttpError(422, 'val.enum', { field: 'priority' });
      fields.push('priority = :priority'); p.priority = ctx.body.priority;
    }
    if (!fields.length) throw new HttpError(422, 'val.no_fields');
    run(`UPDATE support_tickets SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = :id`, p);
    audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'admin.ticket_updated', entity: 'ticket', entityId: id, meta: ctx.body, ip: ctx.ip });
    return { ok: true };
  });

  // ---- exports ------------------------------------------------------------
  route('GET', '/api/admin/export/:kind', { auth: 'admin' }, (ctx) => {
    const out = stats.report(ctx.params.kind, { days: clamp(int(ctx.query.days, 30), 1, 365) });
    if (!out) throw new HttpError(404, 'err.report_not_found');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(`${out.csv}\n`);
    audit({ actorId: ctx.user.id, actorRole: 'admin', action: 'admin.export', entity: 'report', entityId: ctx.params.kind, ip: ctx.ip });
    return undefined;
  });
}

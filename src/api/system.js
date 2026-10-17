import { get, all } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import config from '../config.js';
import { clamp, json } from '../lib/util.js';
import { bindSse } from '../services/events.js';
import { setting, isMaintenance, registrationOpen, sportsEnabled, liveEnabled } from '../services/settings.js';
import { categoriesWithCounts, listLiveTables } from '../services/catalog.js';
import { crashPublicState, roundHistory } from '../services/crash.js';
import { listMail } from '../services/audit.js';
import * as sports from '../services/sports.js';
import { legalDoc, LEGAL_DOCS } from '../data/legal.js';

const activeBanners = () =>
  all(
    `SELECT * FROM banners WHERE active = 1 AND (starts_at IS NULL OR starts_at <= datetime('now'))
       AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY sort, id DESC LIMIT 8`
  ).map((r) => ({
    id: r.id, titleEn: r.title_en, subtitleEn: r.subtitle_en, ctaEn: r.cta_en,
    titleBn: r.title_bn, subtitleBn: r.subtitle_bn, ctaBn: r.cta_bn,
    badge: r.badge, target: r.target, media: r.media, accent: r.accent,
  }));

const activeAnnouncements = () =>
  all(
    `SELECT * FROM announcements WHERE active = 1 AND (starts_at IS NULL OR starts_at <= datetime('now'))
       AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY id DESC LIMIT 6`
  ).map((r) => ({
    id: r.id, type: r.type, titleEn: r.title_en, bodyEn: r.body_en, titleBn: r.title_bn, bodyBn: r.body_bn,
    link: r.link, createdAt: r.created_at,
  }));

export function registerSystemRoutes(route) {
  route('GET', '/api/health', () => ({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    db: get(`SELECT 1 ok`) ? 'up' : 'down',
    demoMode: config.demo.mode,
    maintenance: isMaintenance(),
    version: '1.0.0',
  }));

  /** Everything the shell needs for the first paint. */
  route('GET', '/api/content', (ctx) => {
    const fixtures = sports.listFixtures({ status: null, limit: 12, withMarkets: true });
    return {
      locale: ctx.locale,
      supportedLocales: config.locale.supported,
      branding: { name: setting('site_name', 'ArenaPlay'), termsVersion: setting('terms_version', '1.0.0') },
      demo: {
        mode: true,
        currency: config.demo.currency,
        unit: config.demo.unit,
        noticeKey: 'rg.demo_notice',
        signupBonus: Number(setting('signup_bonus_cents', config.demo.signupBonusCents)),
      },
      flags: {
        registrationOpen: registrationOpen(),
        maintenance: isMaintenance(),
        sports: sportsEnabled(),
        live: liveEnabled(),
        providerLiveData: config.sports.liveEnabled,
        realityCheckEveryMin: Number(setting('reality_check_every_min', config.rg.realityCheckEveryMin)),
      },
      support: { email: setting('support_email'), whatsapp: setting('support_whatsapp') },
      banners: activeBanners(),
      announcements: activeAnnouncements(),
      categories: categoriesWithCounts(),
      liveTables: listLiveTables().slice(0, 8),
      crash: { state: crashPublicState(ctx.user), history: roundHistory(12) },
      sports: { rows: fixtures.rows.slice(0, 10), total: fixtures.total },
      games: { total: get(`SELECT COUNT(*) c FROM games WHERE enabled = 1`)?.c ?? 0 },
      session: ctx.user ? { authenticated: true, role: ctx.user.role, locale: ctx.user.locale } : { authenticated: false },
    };
  });

  route('GET', '/api/events', (ctx) => {
    bindSse(ctx);
    return undefined; // raw SSE stream
  });

  /**
   * DEMO MAILBOX. There is no SMTP transport in this build, so "sent" mail is
   * recorded in the `outbox` table. This endpoint lets a tester actually click
   * a password-reset link in dev, while never exposing other people's mail:
   *  - dev/test: returns the last messages, but only for the address asked for
   *    (an admin gets the whole box);
   *  - production: admin only.
   */
  route('GET', '/api/dev/mailbox/:email', (ctx) => {
    const email = decodeURIComponent(ctx.params.email || '').trim().toLowerCase();
    const isAdmin = ctx.user?.role === 'admin';
    if (config.isProd && !isAdmin) throw new HttpError(403, 'dev.mailbox_disabled');
    const rows = listMail({ limit: 5, email: isAdmin && !email ? null : email });
    const safe = rows.filter((r) => isAdmin || String(r.to_email).toLowerCase() === email);
    return { rows: safe, demoMode: true, noteKey: 'dev.mailbox_note' };
  });

  /**
   * Long-form policy documents, already localised for the request locale so the
   * client never ends up mixing English and Bangla paragraphs.
   */
  route('GET', '/api/legal', (ctx) => ({
    docs: LEGAL_DOCS.map((key) => {
      const d = legalDoc(key, ctx.locale === 'bn' ? 'bn' : 'en');
      return { key, title: d.title, version: d.version, effective: d.effective, sections: d.sections.length };
    }),
    termsVersion: setting('terms_version', '1.0.0'),
  }));

  route('GET', '/api/legal/:doc', (ctx) => {
    const aliases = {
      'gambling-help': 'help', gambling_help: 'help', help: 'help', 'how-to-play': 'rules',
      fair: 'fairness', 'provably-fair': 'fairness',
    };
    const key = aliases[ctx.params.doc] || ctx.params.doc;
    const doc = legalDoc(key, ctx.locale === 'bn' ? 'bn' : 'en');
    if (!doc) throw new HttpError(404, 'err.doc_missing', { doc: ctx.params.doc });
    return doc;
  });
}

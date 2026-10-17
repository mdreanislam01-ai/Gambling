/** Landing page: banners, categories, featured games, live strips, RG panel. */
import { html, render as paint, icon, on } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtMultiplier, fmtCountdown } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, every } from '../core/ui.js';
import { on as onLive } from '../core/sse.js';
import { gameGrid, bilingual, demoNotice, skeletonGrid, GAME_GLYPH } from '../components/widgets.js';

const pick = (key) => state.content?.[key];

export async function render(root, ctx) {
  const content = state.content || (await api.cached('/content'));
  patch({ content });
  const [featured, newOnes, hot] = await Promise.all([
    api.cached('/games?sort=curated&limit=12').catch(() => ({ rows: [] })),
    api.cached('/games?category=new&sort=newest&limit=6').catch(() => ({ rows: [] })),
    api.cached('/games?category=popular&sort=popular&limit=6').catch(() => ({ rows: [] })),
  ]);
  if (!ctx.alive()) return;

  const banners = content.banners?.length ? content.banners : [defaultBanner()];
  const main = banners[0];
  const crash = content.crash?.state || {};
  const sports = (content.sports?.rows || []).slice(0, 4);
  const tables = (content.liveTables || []).slice(0, 4);
  const bonus = state.user ? await api.cached('/wallet', 20000).catch(() => null) : null;

  paint(root, html`
    <div class="container container--wide stack">
      ${content.flags?.maintenance ? html`<div class="notice notice--warn" role="alert">
        <span class="notice__icon">${icon('warn', 18)}</span><div>${t('err.maintenance_body')}</div></div>` : ''}
      ${content.announcements?.length ? html`
        <div class="notice notice--info" role="status">
          <span class="notice__icon">${icon('info', 18)}</span>
          <div class="grow">
            ${content.announcements.slice(0, 2).map((a) => html`<div><strong>${bilingual(a, 'title')}</strong> — ${bilingual(a, 'body')}</div>`)}
          </div>
        </div>` : ''}

      <!-- hero -->
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero__inner">
          <span class="chip chip--gold">${bilingual(main, 'badge') || t('app.demo_badge')}</span>
          <h1 id="hero-title">${bilingual(main, 'title')}</h1>
          <p class="hero__lead">${bilingual(main, 'subtitle')}</p>
          <div class="row row--wrap">
            <a class="btn btn--gold btn--lg" href="/casino" data-link>${icon('chips', 18)}<span>${t('home.cta_play')}</span></a>
            <a class="btn btn--lg" href="/sports" data-link>${icon('sports', 18)}<span>${t('home.cta_sports')}</span></a>
            ${!state.user ? html`<a class="btn btn--ghost" href="/register" data-link>${t('home.cta_join')}${icon('arrow', 16)}</a>` : ''}
          </div>
          <div class="hero__stats">
            <div><div class="stat__v">${fmtNum(content.games?.total || 0)}</div><div class="stat__k">${t('home.stat_games')}</div></div>
            <div><div class="stat__v">${fmtNum(content.categories?.length || 0)}</div><div class="stat__k">${t('home.stat_categories')}</div></div>
            <div><div class="stat__v">${fmtNum(tables.length)}</div><div class="stat__k">${t('home.stat_live_tables')}</div></div>
            <div><div class="stat__v">${t('home.stat_real_money')}</div><div class="stat__k">${t('home.stat_money')}</div></div>
          </div>
          ${banners.length > 1 ? html`
            <div class="row row--wrap" role="tablist" aria-label="${t('home.banners')}">
              ${banners.map((b, i) => html`<button class="btn-tab" type="button" data-banner="${i}" aria-selected="${String(i === 0)}">${bilingual(b, 'title')}</button>`)}
            </div>` : ''}
        </div>
        <div class="hero__glow" aria-hidden="true"></div>
      </section>

      ${bonus?.dailyBonus?.available ? html`
        <div class="notice notice--gold" role="note">
          <span class="notice__icon">${icon('gift', 18)}</span>
          <div class="grow"><strong>${t('wallet.daily_title')}</strong> — ${t('wallet.daily_body', { amount: fmtCredits(bonus.dailyBonus.amount) })}</div>
          <button class="btn btn--gold btn--sm" type="button" data-act="claim">${t('wallet.daily_claim')}</button>
        </div>` : ''}

      <!-- categories -->
      <section class="section" aria-labelledby="cat-title">
        <div class="section__head"><h2 id="cat-title" class="section__title">${t('home.categories')}</h2>
          <span class="grow"></span><a class="btn btn--sm btn--ghost" href="/casino" data-link>${t('btn.view_all')}${icon('arrow', 15)}</a></div>
        <div class="grid-4">
          ${(content.categories || []).filter((c) => !['new', 'popular', 'favorites'].includes(c.key)).map((c) => html`
            <a class="card" href="/casino/${c.key}" data-link>
              <div class="card__body row" style="gap:12px;padding:14px">
                <span class="card__glyph" style="font-size:1.6rem" aria-hidden="true">${GAME_GLYPH[c.key] || '🎮'}</span>
                <div class="grow"><div class="card__title" data-i18n="${c.nameKey}">${t(c.nameKey)}</div>
                  <div class="card__meta">${t('home.games_count', { count: fmtNum(c.count) })}</div></div>
              </div>
            </a>`)}
        </div>
      </section>

      <!-- featured games -->
      <section class="section" aria-labelledby="feat-title">
        <div class="section__head"><h2 id="feat-title" class="section__title">${t('home.featured')}</h2>
          <p class="section__sub">${t('home.featured_sub')}</p></div>
        ${featured.rows?.length ? gameGrid(featured.rows, { favorite: undefined }) : skeletonGrid(8)}
      </section>

      <div class="grid-2 section">
        <!-- crash widget -->
        <section class="panel" aria-labelledby="crash-title">
          <div class="panel__head">${icon('rocket', 18)}<h3 id="crash-title">${t('game.crash')}</h3>
            <span class="chip chip--soft" data-role="crash-status">${t(`crash.phase.${crash.status || 'idle'}`)}</span></div>
          <div class="panel__body stack">
            <div class="row row--between">
              <div>
                <div class="stat__v" data-role="crash-mult" style="font-size:2rem">${fmtMultiplier(crash.multiplier || 1)}</div>
                <div class="section__sub" data-role="crash-note">${crashNote(crash)}</div>
              </div>
              <a class="btn btn--gold" href="/game/rocket-crash" data-link>${t('btn.play')}${icon('arrow', 15)}</a>
            </div>
            <div class="crash-history" data-role="crash-history">
              ${(content.crash?.history || []).map((h) => html`<b data-tier="${tier(h.multiplier)}">${fmtMultiplier(h.multiplier)}</b>`)}
            </div>
          </div>
        </section>

        <!-- live studio -->
        <section class="panel" aria-labelledby="live-title">
          <div class="panel__head">${icon('live', 18)}<h3 id="live-title">${t('home.live_title')}</h3>
            <span class="chip chip--red chip--live">${t('live.simulated')}</span></div>
          <div class="panel__body stack">
            ${tables.length ? tables.map((tb) => html`
              <a class="row" href="/live/${tb.key}" data-link style="padding:7px 0">
                <span class="card__glyph" style="font-size:1.25rem" aria-hidden="true">${GAME_GLYPH[tb.engine] || '🃏'}</span>
                <span class="grow"><strong>${tb.name}</strong>
                  <div class="card__meta">${t('live.dealer', { name: tb.dealer || t('live.dealer_generic') })} · ${t('live.players', { count: fmtNum(tb.players || 0) })}</div></span>
                <span class="chip ${tb.status === 'open' ? 'chip--green' : 'chip--soft'}">${t(`live.phase.${tb.status || 'betting'}`, { defaultValue: tb.status || '' })}</span>
              </a>`) : html`<p class="section__sub">${t('empty.live')}</p>`}
            <a class="btn btn--block" href="/live" data-link>${t('btn.view_all_tables')}</a>
          </div>
        </section>
      </div>

      ${content.flags?.sports === false ? '' : html`
      <!-- sports -->
      <section class="section" aria-labelledby="sport-title">
        <div class="section__head"><h2 id="sport-title" class="section__title">${t('home.sports_title')}</h2>
          <span class="chip chip--soft">${t('sports.demo_label')}</span>
          <span class="grow"></span><a class="btn btn--sm" href="/sports" data-link>${t('btn.open_board')}${icon('arrow', 15)}</a></div>
        <div class="grid-2">
          ${sports.length ? sports.map((f) => matchMini(f)) : html`<div class="panel"><div class="panel__body">${t('empty.fixtures')}</div></div>`}
        </div>
      </section>`}

      <div class="grid-2 section">
        <section class="panel" aria-labelledby="new-title">
          <div class="panel__head">${icon('star', 18)}<h3 id="new-title">${t('home.new_games')}</h3></div>
          <div class="panel__body panel__body--tight">${newOnes.rows?.length ? gameGrid(newOnes.rows) : html`<p class="section__sub">${t('empty.games')}</p>`}</div>
        </section>
        <section class="panel" aria-labelledby="hot-title">
          <div class="panel__head">${icon('trophy', 18)}<h3 id="hot-title">${t('home.most_played')}</h3></div>
          <div class="panel__body panel__body--tight">${hot.rows?.length ? gameGrid(hot.rows) : html`<p class="section__sub">${t('empty.games')}</p>`}</div>
        </section>
      </div>

      <!-- trust -->
      <section class="section promo-grid" aria-label="${t('home.trust_title')}">
        <div class="promo promo--gold">
          <h3>${t('home.trust_demo')}</h3><p class="promo__sub">${t('home.trust_demo_body')}</p>
          <a class="promo__cta" href="/legal/terms" data-link>${t('btn.read_terms')}${icon('arrow', 14)}</a>
        </div>
        <div class="promo promo--emerald">
          <h3>${t('home.trust_fair')}</h3><p class="promo__sub">${t('home.trust_fair_body')}</p>
          <a class="promo__cta" href="/fairness" data-link>${t('btn.verify')}${icon('arrow', 14)}</a>
        </div>
        <div class="promo promo--red">
          <h3>${t('home.trust_rg')}</h3><p class="promo__sub">${t('home.trust_rg_body')}</p>
          <a class="promo__cta" href="/responsible" data-link>${t('btn.set_limits')}${icon('arrow', 14)}</a>
        </div>
      </section>
      ${demoNotice('compliance.demo_long')}
    </div>`);

  const el = root;
  // banner tabs
  on(el, 'click', '[data-banner]', (ev, b) => {
    const i = Number(b.dataset.banner);
    const banner = banners[i];
    const box = el.querySelector('.hero__inner');
    box.querySelector('h1').textContent = bilingual(banner, 'title');
    box.querySelector('.hero__lead').textContent = bilingual(banner, 'subtitle');
    box.querySelectorAll('[data-banner]').forEach((x, j) => x.setAttribute('aria-selected', String(j === i)));
  });
  // daily bonus
  el.querySelector('[data-act=claim]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const r = await api.post('/wallet/claim-daily');
      await refreshWallet();
      toastOk(t('wallet.daily_done', { amount: fmtCredits(r.amount) }));
      ev.currentTarget.closest('.notice').remove();
    } catch (err) { btn.disabled = false; toastError(err); }
  });

  // live crash updates
  const statusChip = el.querySelector('[data-role=crash-status]');
  const multEl = el.querySelector('[data-role=crash-mult]');
  const noteEl = el.querySelector('[data-role=crash-note]');
  const histEl = el.querySelector('[data-role=crash-history]');
  const applyCrash = (s) => {
    const st = s?.state || s || {};
    if (!multEl) return;
    multEl.textContent = fmtMultiplier(st.multiplier || 1);
    multEl.style.color = st.status === 'crashed' ? 'var(--red)' : st.status === 'flying' ? 'var(--green)' : '';
    if (statusChip) statusChip.textContent = t(`crash.phase.${st.status || 'idle'}`);
    if (noteEl) noteEl.textContent = crashNote(st);
  };
  applyCrash({ state: crash });
  const off1 = onLive('crash:tick', applyCrash);
  const off2 = onLive('crash:crashed', (p) => {
    applyCrash(p);
    if (histEl && (p?.crashPoint || p?.multiplier)) {
      const b = document.createElement('b');
      b.dataset.tier = tier(p.multiplier);
      b.textContent = fmtMultiplier(p.crashPoint || p.multiplier || 1);
      histEl.prepend(b);
      while (histEl.children.length > 12) histEl.lastElementChild.remove();
    }
  });
  const stopTimer = every(1000, () => {
    for (const n of el.querySelectorAll('[data-countdown]')) n.textContent = fmtCountdown(Number(n.dataset.countdown));
  });
  return () => { off1(); off2(); stopTimer(); };
}

const tier = (m) => (m >= 5 ? 'high' : m >= 2 ? 'mid' : 'low');
const crashNote = (st) => {
  if (!st || !st.status) return t('crash.idle');
  if (st.status === 'betting') return t('crash.betting_in', { time: t('crash.seconds', { n: fmtNum(Math.max(0, Math.round((parseEnds(st.phaseEndsAt) - Date.now()) / 1000))) }) });
  if (st.status === 'flying') return t('crash.flying');
  if (st.status === 'crashed') return t('crash.crashed_at', { value: fmtMultiplier(st.crashPoint || st.multiplier || 1) });
  return t('crash.idle');
};
const parseEnds = (v) => {
  if (!v) return Date.now();
  if (typeof v === 'number') return v;
  const s = String(v).replace(' ', 'T');
  const ms = Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  return Number.isNaN(ms) ? Date.now() : ms;
};

const defaultBanner = () => ({
  id: 0,
  titleEn: 'Demo casino & sports — virtual credits only',
  titleBn: 'ডেমো ক্যাসিনো ও স্পোর্টস — শুধু ভার্চুয়াল ক্রেডিট',
  subtitleEn: 'Slots, roulette, blackjack, crash, live tables and a cricket/football board — every game runs for real, but the credits are pretend. No deposits, no withdrawals, no cash prizes.',
  subtitleBn: 'স্লট, রুলেট, ব্ল্যাকজ্যাক, ক্র্যাশ, লাইভ টেবিল আর ক্রিকেট/ফুটবল বোর্ড — প্রতিটি গেম আসলেই চলে, কিন্তু ক্রেডিট কাল্পনিক। জমা নেই, তোলা নেই, নগদ পুরস্কার নেই।',
  ctaEn: 'Play demo', ctaBn: 'ডেমো খেলুন',
  badgeEn: 'Demo mode', badgeBn: 'ডেমো মোড',
  accent: 'gold', target: '/casino',
});

function matchMini(f) {
  const kickoff = Date.parse(String(f.kickoff || '').replace(' ', 'T') + (String(f.kickoff || '').endsWith('Z') ? '' : 'Z')) || Date.now();
  const live = f.status === 'live';
  const done = f.status === 'final' || f.status === 'settled';
  return html`
    <a class="card" href="/sports/match/${f.id}" data-link>
      <div class="card__body" style="gap:8px">
        <div class="card__meta">
          <span>${f.league?.name || t(`sports.${f.sport}`)}</span>
          <span class="chip ${live ? 'chip--red chip--live' : 'chip--soft'}">${t(`sports.status.${f.status}`)}</span>
          ${f.simulated ? html`<span class="chip chip--gold">${t('sports.demo_label')}</span>` : ''}
        </div>
        <div class="match__team"><span class="grow">${f.home?.name || ''}</span>${done || live ? html`<b class="match__score">${fmtNum(f.score?.home ?? 0)}</b>` : ''}</div>
        <div class="match__team"><span class="grow">${f.away?.name || ''}</span>${done || live ? html`<b class="match__score">${fmtNum(f.score?.away ?? 0)}</b>` : ''}</div>
        <div class="card__meta">
          <span>${live ? t('sports.minute', { minute: fmtNum(f.minute || 0) }) : html`<span data-countdown="${kickoff}">${fmtCountdown(kickoff)}</span>`}</span>
          <span class="grow"></span>
          <span>${f.sport === 'cricket' ? '🏏' : '⚽'}</span>
        </div>
      </div>
    </a>`;
}

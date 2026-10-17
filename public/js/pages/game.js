/** Game page: header, engine view, side panels. One router entry for 20 games. */
import { html, render as paint, icon, on } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtMultiplier, fmtPercent, fmtRelative } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, toggleFavoriteLocal, refreshWallet } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, modal, every } from '../core/ui.js';
import { GameSession } from '../game/session.js';
import { VIEWS } from '../game/views.js';

export async function render(root, ctx) {
  const key = ctx.params.key;
  let data;
  try {
    data = await api.get(`/games/${encodeURIComponent(key)}`);
  } catch (err) {
    paint(root, html`<div class="container"><div class="panel"><div class="panel__body empty">
      <span class="empty__icon">${icon('warn', 30)}</span><h2>${t(err?.code || 'err.game_not_found', err?.params || {})}</h2>
      <p class="section__sub">${t('game.not_found_body')}</p>
      <a class="btn btn--gold" href="/casino" data-link>${t('btn.back_lobby')}</a></div></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const game = data.game;
  if (!game.enabled || game.visibility === 'hidden') {
    if (state.user?.role !== 'admin') {
      paint(root, html`<div class="container"><div class="panel"><div class="panel__body empty">
        <h2>${t('game.disabled')}</h2><p class="section__sub">${t('game.disabled_body')}</p>
        <a class="btn btn--gold" href="/casino" data-link>${t('btn.back_lobby')}</a></div></div></div>`);
      return;
    }
  }
  const fav = !!state.favorites.includes(game.key) || (data.favorites || []).includes(game.key);
  const isLive = game.category === 'live' || String(game.engine).endsWith('_live');

  paint(root, html`
    <div class="container container--wide stack" data-game="${game.key}">
      <nav class="row" aria-label="${t('a11y.crumbs')}" style="gap:6px;font-size:.8rem;color:var(--muted)">
        <a href="/casino" data-link>${t('nav.casino')}</a><span aria-hidden="true">/</span>
        <a href="/casino/${game.category}" data-link data-i18n="cat.${game.category}">${t(`cat.${game.category}`)}</a>
        <span aria-hidden="true">/</span><span style="color:var(--text)">${game.nameKey ? t(game.nameKey) : game.name}</span>
        ${isLive ? html`<span class="chip chip--red chip--live">${t('live.simulated')}</span>` : ''}
      </nav>

      <header class="panel"><div class="panel__body row row--wrap" style="gap:14px">
        <div class="card__art art--${game.accent || 'gold'}" style="width:74px;height:74px;border-radius:14px;flex:none">
          <span class="card__glyph" style="font-size:2rem" aria-hidden="true">${iconFor(game)}</span>
        </div>
        <div class="grow">
          <h1 style="margin:0">${game.nameKey ? t(game.nameKey) : game.name}</h1>
          <p class="section__sub" style="margin:2px 0 0">${t(game.descriptionKey || 'game.default_desc')}</p>
          <div class="row row--wrap" style="gap:8px;margin-top:8px">
            <span class="chip chip--soft">${t('game.rtp')} ${game.rtpBps ? fmtPercent(game.rtpBps) : '—'}</span>
            <span class="chip chip--soft">${t('game.volatility')}: ${t(`game.vol.${game.volatility || 'medium'}`)}</span>
            <span class="chip chip--soft">${t('game.limits')}: ${fmtCredits(game.minBet)}–${fmtCredits(game.maxBet)}</span>
            <span class="chip chip--soft">${fmtNum(game.plays || 0)} ${t('game.plays')}</span>
            <span class="chip ${state.user ? 'chip--gold' : 'chip--soft'}">${t('app.demo_badge')}</span>
          </div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn btn--sm" type="button" data-act="fav" aria-pressed="${String(fav)}">${icon('star', 15)}<span>${t('game.favorite')}</span></button>
          <button class="btn btn--sm btn--ghost" type="button" data-act="rules">${icon('info', 15)}<span>${t('btn.how_to_play')}</span></button>
          ${isLive ? html`<a class="btn btn--sm" href="/live/${game.key}" data-link>${t('btn.open_studio')}</a>` : ''}
        </div>
      </div></header>

      <div data-role="play"></div>

      <section class="panel" data-role="rounds" hidden>
        <div class="panel__head">${icon('clock', 16)}<h3>${t('game.rounds')}</h3>
          <span class="grow"></span><span class="section__sub">${t('game.rounds_note')}</span></div>
        <div class="panel__body panel__body--tight"><div data-role="rounds-body"></div></div>
      </section>

      <section class="section" data-role="related">
        <div class="section__head"><h2 class="section__title">${t('game.more_games')}</h2></div>
        <div data-role="related-body"></div>
      </section>
      ${!state.user ? html`
        <div class="notice notice--info" role="note">${icon('user', 18)}
          <div class="grow">${t('game.guest_notice')}</div>
          <a class="btn btn--gold btn--sm" href="/login?next=${encodeURIComponent('/game/' + game.key)}" data-link>${t('auth.login')}</a>
        </div>` : ''}
    </div>`);

  const host = root.querySelector('[data-role=play]');
  const session = new GameSession({ game, host });
  const view = VIEWS[game.engine] || VIEWS.generic;
  try {
    await session.mount(view);
  } catch (err) {
    console.error('[session]', err);
    paint(host, html`<div class="panel"><div class="panel__body empty"><span class="empty__icon">${icon('warn', 26)}</span>
      <h3>${t('err.game_view')}</h3><p class="section__sub">${err?.message || ''}</p></div></div>`);
  }
  if (root.querySelector('[data-verify]')) {
    on(root, 'click', '[data-verify]', (ev, b) => import('../game/session.js').then((m) => m.openVerifier(b.dataset.verify)));
  }

  root.querySelector('[data-act=fav]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!state.user) { toast(t('auth.need_login_fav')); return; }
    const onNow = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(onNow));
    toggleFavoriteLocal(game.key, onNow);
    try { await api.post(`/favorites/${game.key}`, { on: onNow }); toastOk(t(onNow ? 'lobby.fav_added' : 'lobby.fav_removed')); }
    catch (err) { btn.setAttribute('aria-pressed', String(!onNow)); toggleFavoriteLocal(game.key, !onNow); toastError(err); }
  });
  root.querySelector('[data-act=rules]')?.addEventListener('click', () => openRules(game));

  // rounds (public result log for this game)
  api.get(`/rounds/${encodeURIComponent(game.key)}`).then((r) => {
    if (!ctx.alive() || !r.rows?.length) return;
    const box = root.querySelector('[data-role=rounds]');
    box.hidden = false;
    paint(box.querySelector('[data-role=rounds-body]'), html`
      <div class="list-divided">
        ${r.rows.slice(0, 8).map((row) => html`
          <div class="row" style="gap:8px">
            <span class="badge badge--${row.status === 'ended' ? 'won' : 'pending'}">${t(`round.status.${row.status}`)}</span>
            <span class="mono">${row.result?.number !== undefined ? `#${row.result.number}` : row.result?.multiplierBps ? fmtMultiplier(row.result.multiplierBps / 10000) : fmtMultiplier(row.result?.multiplier || 0)}</span>
            <span class="grow section__sub mono">${String(row.server_seed_hash || '').slice(0, 18)}…</span>
            <span class="section__sub">${fmtRelative(row.ended_at || row.started_at)}</span>
          </div>`)}
      </div>`);
  }).catch(() => {});

  // related games
  api.get(`/games?category=${game.category}&limit=6`).then((r) => {
    if (!ctx.alive()) return;
    const rows = (r.rows || []).filter((g) => g.key !== game.key).slice(0, 5);
    const host2 = root.querySelector('[data-role=related-body]');
    if (!rows.length) { root.querySelector('[data-role=related]').hidden = true; return; }
    import('../components/widgets.js').then((m) => paint(host2, m.gameGrid(rows)));
  }).catch(() => {});

  const cleanup = typeof session.cleanup === 'function' ? session.cleanup : null;
  return () => { cleanup?.(); };
}

const iconFor = (g) => ({ slots: '🎰', roulette: '🎡', dice: '🎲', mines: '💣', wheel: '🎯', plinko: '🔻', bingo: '🅱️', crash: '🚀', blackjack: '🃏', baccarat: '♠️', video_poker: '🂡', three_patti: '🎴' })[g.engine] || '🎮';

async function openRules(game) {
  const doc = await api.cached('/legal/rules').catch(() => null);
  modal({
    title: `${game.nameKey ? t(game.nameKey) : game.name} — ${t('btn.how_to_play')}`,
    wide: true,
    body: html`
      <div class="stack">
        <div class="notice notice--gold">${icon('info', 18)}<div>${t('game.rules_demo_note')}</div></div>
        <dl class="kv">
          <dt>${t('game.rtp')}</dt><dd>${game.rtpBps ? fmtPercent(game.rtpBps) : '—'}</dd>
          <dt>${t('game.house_edge')}</dt><dd>${game.houseEdgeBps ? fmtPercent(game.houseEdgeBps) : '—'}</dd>
          <dt>${t('game.min')}</dt><dd>${fmtCredits(game.minBet)}</dd>
          <dt>${t('game.max')}</dt><dd>${fmtCredits(game.maxBet)}</dd>
          <dt>${t('game.volatility')}</dt><dd>${t(`game.vol.${game.volatility || 'medium'}`)}</dd>
          <dt>${t('game.engine')}</dt><dd class="mono">${game.engine}</dd>
        </dl>
        ${doc?.sections?.length ? html`
          <div class="list-divided">
            ${doc.sections.filter((sec) => new RegExp(game.engine, 'i').test(sec.heading) || /slots|roulette|blackjack|baccarat|video poker|crash|mines|dice|wheel|plinko|bingo/i.test(sec.heading)).slice(0, 4).map((sec) => html`
              <div><h4 style="margin:0 0 4px">${sec.heading}</h4>${sec.paragraphs.map((para) => html`<p class="section__sub">${para}</p>`)}</div>`)}
          </div>` : html`<p class="section__sub">${t('game.rules_generic')}</p>`}
        <a class="btn btn--sm" href="/legal/rules" data-link>${t('btn.all_rules')}</a>
      </div>`,
    actions: [{ label: t('btn.close') }, { label: t('btn.play'), variant: 'gold', onClick: () => { const b = document.querySelector('[data-role=place]'); b?.click(); } }],
  });
}

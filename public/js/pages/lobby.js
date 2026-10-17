/** Casino lobby: categories, search, sorting, favourites, history, infinite grid. */
import { html, render as paint, icon, on, qsa } from '../core/dom.js';
import { t, fmtCredits, fmtNum } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, toggleFavoriteLocal, refreshFavorites } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, drawer, debounce } from '../core/ui.js';
import { gameCard, skeletonGrid, emptyState, demoNotice, pageHeader, dataTable } from '../components/widgets.js';

const SORTS = [
  { key: 'curated', labelKey: 'lobby.sort_curated' },
  { key: 'popular', labelKey: 'lobby.sort_popular' },
  { key: 'newest', labelKey: 'lobby.sort_newest' },
  { key: 'az', labelKey: 'lobby.sort_az' },
];
const PAGE = 24;

export async function render(root, ctx) {
  const cat = ctx.params.category || null;
  const initial = {
    search: ctx.query.q || '',
    sort: ctx.query.sort || 'curated',
    onlyFav: ctx.query.fav === '1',
    category: cat,
  };
  const ui = {
    rows: [], total: 0, categories: [], offset: 0, loading: true, error: null,
    search: initial.search, sort: initial.sort, onlyFav: initial.onlyFav, category: initial.category,
    history: [],
  };
  if (state.user) {
    api.get('/bets?limit=40').then((r) => { ui.history = r.rows || []; load(); }).catch(() => load());
  } else load();

  async function load(reset = true) {
    if (reset) { ui.offset = 0; ui.rows = []; ui.loading = true; }
    paintList();
    const params = new URLSearchParams();
    if (ui.category && ui.category !== 'all') params.set('category', ui.category);
    if (ui.search) params.set('search', ui.search);
    params.set('sort', ui.sort);
    params.set('limit', String(PAGE));
    params.set('offset', String(ui.offset));
    try {
      const data = await api.get(`/games?${params}`);
      if (!ctx.alive()) return;
      ui.rows = reset ? data.rows : [...ui.rows, ...data.rows];
      ui.total = data.total;
      ui.categories = data.categories || ui.categories;
      ui.loading = false;
      ui.error = null;
      paintList();
    } catch (err) {
      ui.loading = false;
      ui.error = err;
      if (ctx.alive()) paintList();
    }
  }

  function paintList() {
    const host = root.querySelector('[data-role=list]');
    if (!host) return;
    if (ui.loading && !ui.rows.length) { paint(host, skeletonGrid(10)); return; }
    if (ui.error) {
      paint(host, emptyState({ icon: 'warn', titleKey: 'err.load_games', bodyKey: 'err.load_games_body', action: html`<button class="btn btn--gold" type="button" data-retry>${t('btn.retry')}</button>` }));
      return;
    }
    if (!ui.rows.length) {
      paint(host, emptyState({
        titleKey: ui.onlyFav && !state.user ? 'auth.need_login' : 'lobby.none',
        bodyKey: ui.search ? 'lobby.none_body' : '',
        action: html`<button class="btn" type="button" data-clear>${t('lobby.clear_filters')}</button>`,
      }));
      return;
    }
    paint(host, html`
      <div class="grid-games">${ui.rows.map((g) => gameCard(g, { favorite: !!g.favorite || state.favorites.includes(g.key) }))}</div>
      <div class="row row--between" style="margin-top:14px">
        <span class="section__sub">${t('lobby.showing', { shown: fmtNum(ui.rows.length), total: fmtNum(ui.total) })}</span>
        ${ui.rows.length < ui.total ? html`<button class="btn" type="button" data-more>${t('lobby.load_more')}${icon('arrow', 15)}</button>` : ''}
      </div>`);
    root.querySelector('[data-more]')?.addEventListener('click', () => { ui.offset += PAGE; load(false); });
    root.querySelector('[data-retry]')?.addEventListener('click', () => load());
    root.querySelector('[data-clear]')?.addEventListener('click', () => { ui.search = ''; ui.onlyFav = false; root.querySelector('[data-search-input]').value = ''; syncUrl(); load(); });
  }

  const listHtml = html`
    <div class="layout-lobby">
      <aside class="layout-lobby__side" aria-label="${t('lobby.filters')}">
        <div class="panel">
          <div class="panel__head">${icon('search', 17)}<h3>${t('lobby.search')}</h3></div>
          <div class="panel__body stack">
            <div class="search">
              <span class="search__icon">${icon('search', 16)}</span>
              <input class="input" type="search" data-search-input placeholder="${t('nav.search_ph')}" aria-label="${t('lobby.search')}" value="${ui.search}" />
            </div>
            <div class="field">
              <label class="field__label" for="lobby-sort">${t('lobby.sort')}</label>
              <select class="select" id="lobby-sort" data-sort>
                ${SORTS.map((s) => html`<option value="${s.key}" ${s.key === ui.sort ? 'selected' : ''}>${t(s.labelKey)}</option>`)}
              </select>
            </div>
            <label class="check"><input type="checkbox" data-only-fav ${ui.onlyFav ? 'checked' : ''} /><span>${t('lobby.fav_only')}</span></label>
            <div class="list-divided">
              ${[{ key: null, nameKey: 'lobby.all', count: ui.total }, ...ui.categories.filter((c) => c.key !== 'favorites')].map((c) => html`
                <a href="/casino${c.key ? `/${c.key}` : ''}${ui.search ? `?q=${encodeURIComponent(ui.search)}` : ''}" data-cat="${c.key || ''}" class="row"
                  style="padding:6px 2px;${c.key === ui.category ? 'color:var(--gold);font-weight:800' : ''}">
                  <span class="grow" data-i18n="${c.nameKey}">${t(c.nameKey)}</span>
                  <span class="chip chip--soft">${fmtNum(c.count ?? 0)}</span>
                </a>`)}
            </div>
          </div>
        </div>
      </aside>

      <div class="stack">
        ${pageHeader({
          titleKey: ui.category ? `cat.${ui.category}` : 'casino.title',
          sub: ui.category ? t('casino.sub') : t('casino.sub'),
          actions: html`<button class="btn btn--sm only-sm" type="button" data-open-filters>${icon('search', 15)}<span>${t('lobby.filters')}</span></button>`,
        })}
        <div class="row row--wrap filters scroll-x" role="toolbar" aria-label="${t('lobby.quick_categories')}">
          <button class="btn-tab" type="button" data-cat="" aria-selected="${String(!ui.category)}">${t('lobby.all')}</button>
          ${(ui.categories.length ? ui.categories : (state.content?.categories || [])).map((c) => html`
            <button class="btn-tab" type="button" data-cat="${c.key}" aria-selected="${String(c.key === ui.category)}">
              <span data-i18n="${c.nameKey}">${t(c.nameKey)}</span> <span style="opacity:.7">${fmtNum(c.count)}</span>
            </button>`)}
          ${state.user ? html`<button class="btn-tab" type="button" data-cat="favorites" aria-selected="${String(ui.category === 'favorites')}">${icon('star', 13)}<span>${t('cat.favorites')}</span></button>` : ''}
        </div>
        <div data-role="list" aria-live="polite"></div>
      </div>

      <aside class="layout-lobby__side stack" aria-label="${t('lobby.side')}">
        <section class="panel">
          <div class="panel__head">${icon('clock', 17)}<h3>${t('lobby.recent')}</h3></div>
          <div class="panel__body">
            ${state.user ? (ui.history.length ? html`
              <div class="list-divided">
                ${ui.history.slice(0, 6).map((b) => html`
                  <a class="row" href="/game/${b.gameKey}" data-link style="padding:5px 0">
                    <span class="grow"><strong style="font-size:.86rem">${b.gameName || t(`game.${b.gameKey}`, { defaultValue: b.gameKey })}</strong>
                      <div class="card__meta">${fmtCredits(b.stake)} → ${fmtCredits(b.payout)}</div></span>
                    <span class="badge badge--${b.status}">${t(`bet.status.${b.status}`)}</span>
                  </a>`)}
              </div>` : html`<p class="section__sub">${t('lobby.recent_empty')}</p>`)
            : html`<p class="section__sub">${t('lobby.recent_guest')}</p><a class="btn btn--sm btn--gold" href="/login" data-link>${t('auth.login')}</a>`}
          </div>
        </section>
        <section class="panel">
          <div class="panel__head">${icon('shield', 17)}<h3>${t('lobby.fair_title')}</h3></div>
          <div class="panel__body stack">
            <p class="section__sub">${t('lobby.fair_body')}</p>
            <a class="btn btn--sm" href="/fairness" data-link>${t('btn.open_fairness')}</a>
          </div>
        </section>
        ${demoNotice('compliance.demo_short')}
      </aside>
    </div>`;

  paint(root, html`<div class="container container--wide">${listHtml}</div>`);
  paintList();

  const syncUrl = () => {
    const params = new URLSearchParams();
    if (ui.search) params.set('q', ui.search);
    if (ui.sort !== 'curated') params.set('sort', ui.sort);
    if (ui.onlyFav) params.set('fav', '1');
    const qs = params.toString();
    navigate(`/casino${ui.category ? `/${ui.category}` : ''}${qs ? `?${qs}` : ''}`, { replace: true, scroll: false });
  };

  const debouncedSearch = debounce((v) => { ui.search = v; syncUrl(); load(); }, 320);
  const searchInput = root.querySelector('[data-search-input]');
  searchInput?.addEventListener('input', (ev) => debouncedSearch(ev.target.value.trim()));
  searchInput?.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ui.search = ev.target.value.trim(); syncUrl(); load(); } });
  root.querySelector('[data-sort]')?.addEventListener('change', (ev) => { ui.sort = ev.target.value; syncUrl(); load(); });
  root.querySelector('[data-only-fav]')?.addEventListener('change', (ev) => {
    if (!state.user) { ev.target.checked = false; toast(t('auth.need_login')); navigate('/login?next=/casino'); return; }
    ui.onlyFav = ev.target.checked;
    ui.category = ui.onlyFav ? 'favorites' : null;
    syncUrl();
    load();
  });
  on(root, 'click', '[data-cat]', (ev, b) => {
    ev.preventDefault();
    const next = b.dataset.cat || null;
    ui.category = next === ui.category ? null : next;
    paint(root, html`<div class="container container--wide">${listHtml}</div>`);
    paintList();
    syncUrl();
    load();
  });

  // favourite toggle (server-backed, optimistic)
  on(root, 'click', '[data-fav]', async (ev, btn) => {
    ev.preventDefault();
    const key = btn.dataset.fav;
    if (!state.user) { toast(t('auth.need_login_fav')); return; }
    const onNow = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(onNow));
    toggleFavoriteLocal(key, onNow);
    try {
      const r = await api.post(`/favorites/${key}`, { on: onNow });
      patch({ favorites: r.keys || state.favorites });
      toastOk(t(onNow ? 'lobby.fav_added' : 'lobby.fav_removed'));
      if (ui.category === 'favorites') load();
      api.invalidate('/games');
    } catch (err) {
      btn.setAttribute('aria-pressed', String(!onNow));
      toggleFavoriteLocal(key, !onNow);
      toastError(err);
    }
  });

  root.querySelector('[data-open-filters]')?.addEventListener('click', () => {
    const body = document.createElement('div');
    paint(body, html`
      <div class="search"><span class="search__icon">${icon('search', 16)}</span>
        <input class="input" data-mobile-search placeholder="${t('nav.search_ph')}" value="${ui.search}" /></div>
      <div class="field" style="margin-top:12px"><label class="field__label">${t('lobby.sort')}</label>
        <select class="select" data-mobile-sort>${SORTS.map((s) => html`<option value="${s.key}" ${s.key === ui.sort ? 'selected' : ''}>${t(s.labelKey)}</option>`)}</select></div>
      <div class="row row--wrap" style="margin-top:12px">
        <button class="btn-tab" type="button" data-cat="" aria-selected="${String(!ui.category)}">${t('lobby.all')}</button>
        ${ui.categories.map((c) => html`<button class="btn-tab" type="button" data-cat="${c.key}" aria-selected="${String(c.key === ui.category)}">${t(c.nameKey)}</button>`)}
      </div>`);
    const d = drawer({ title: t('lobby.filters'), body });
    body.querySelector('[data-mobile-search]')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ui.search = ev.target.value.trim(); d.close(); syncUrl(); load(); }
    });
    body.querySelector('[data-mobile-sort]')?.addEventListener('change', (ev) => { ui.sort = ev.target.value; d.close(); syncUrl(); load(); });
    on(body, 'click', '[data-cat]', (ev, b) => { ui.category = b.dataset.cat || null; d.close(); syncUrl(); load(); });
  });

  return () => { qsa('[data-observed]').forEach((n) => n.removeAttribute('data-observed')); };
}

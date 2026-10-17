/**
 * App shell + router. Pages are lazily imported ES modules; each exports
 * `{ render(container, ctx) }` and may return a cleanup function.
 */
import { html, render, icon, qs, on } from './core/dom.js';
import { t, locale, loadLocale, setLocale, preferredLocale, translateTree, isBengali } from './core/i18n.js';
import { state, patch, subscribe, emit, refreshSession, refreshContent, refreshNotifications, refreshFavorites, isStaff } from './core/state.js';
import { api } from './core/api.js';
import { connectLive, on as onLive, isLiveConnected } from './core/sse.js';
import { toast, toastError, modal, drawer, every, progressStart, progressEnd } from './core/ui.js';

export const routes = [
  { path: '/', page: 'home', title: 'title.home' },
  { path: '/casino', page: 'lobby', title: 'title.casino' },
  { path: '/casino/:category', page: 'lobby', title: 'title.casino' },
  { path: '/game/:key', page: 'game', title: 'title.game', auth: false },
  { path: '/live', page: 'live', title: 'title.live' },
  { path: '/live/:key', page: 'live', title: 'title.live' },
  { path: '/sports', page: 'sports', title: 'title.sports' },
  { path: '/sports/:sport', page: 'sports', title: 'title.sports' },
  { path: '/sports/match/:id', page: 'sports', title: 'title.match' },
  { path: '/login', page: 'auth', title: 'title.login', guest: true },
  { path: '/register', page: 'auth', title: 'title.register', guest: true },
  { path: '/forgot-password', page: 'auth', title: 'title.forgot' },
  { path: '/reset-password', page: 'auth', title: 'title.reset' },
  { path: '/account', page: 'account', title: 'title.account', auth: true },
  { path: '/account/:tab', page: 'account', title: 'title.account', auth: true },
  { path: '/wallet', page: 'account', title: 'title.wallet', auth: true, tab: 'wallet' },
  { path: '/history', page: 'account', title: 'title.history', auth: true, tab: 'history' },
  { path: '/favorites', page: 'account', title: 'title.favorites', auth: true, tab: 'favorites' },
  { path: '/notifications', page: 'account', title: 'title.notifications', auth: true, tab: 'notifications' },
  { path: '/responsible', page: 'account', title: 'title.responsible', auth: true, tab: 'responsible' },
  { path: '/support', page: 'account', title: 'title.support', auth: true, tab: 'support' },
  { path: '/settings', page: 'account', title: 'title.settings', auth: true, tab: 'settings' },
  { path: '/fairness', page: 'info', title: 'title.fairness', tab: 'fairness' },
  { path: '/info/:doc', page: 'info', title: 'title.info' },
  { path: '/legal/:doc', page: 'info', title: 'title.legal' },
  { path: '/admin', page: 'admin', title: 'title.admin', staff: true },
  { path: '/admin/:tab', page: 'admin', title: 'title.admin', staff: true },
  { path: '/404', page: 'info', title: 'title.404', tab: '404' },
];

const NAV = [
  { href: '/casino', key: 'nav.casino', icon: 'chips' },
  { href: '/live', key: 'nav.live', icon: 'live' },
  { href: '/sports', key: 'nav.sports', icon: 'sports' },
  { href: '/fairness', key: 'nav.fairness', icon: 'shield' },
];
const TABS = [
  { href: '/', key: 'nav.home', icon: 'home' },
  { href: '/casino', key: 'nav.casino', icon: 'chips' },
  { href: '/live', key: 'nav.live', icon: 'live' },
  { href: '/sports', key: 'nav.sports', icon: 'sports' },
  { href: '/account', key: 'nav.account', icon: 'user' },
];

export const router = { path: '/', params: {}, cleanup: null, token: 0 };
const pageCache = new Map();

export function match(pathname) {
  const segs = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const r of routes) {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rs.length; i += 1) {
      if (rs[i].startsWith(':')) params[rs[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (rs[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export function navigate(to, { replace = false, scroll = true } = {}) {
  const url = new URL(to, location.origin);
  if (url.origin !== location.origin) { location.href = to; return; }
  const method = replace ? 'replaceState' : 'pushState';
  history[method](null, '', url.pathname + url.search);
  render({ scroll });
  if (replace) return;
}
export const back = () => history.back();

async function loadPage(name) {
  if (pageCache.has(name)) return pageCache.get(name);
  const mod = await import(`./pages/${name}.js`);
  pageCache.set(name, mod);
  return mod;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
let shellBuilt = false;

function shell() {
  if (shellBuilt) return;
  const root = qs('#app');
  render(root, html`
    <header class="hdr" role="banner">
      <div class="container container--wide hdr__inner">
        <button class="icon-btn nav-burger" type="button" aria-label="${t('a11y.menu')}" id="burger">${icon('menu', 20)}</button>
        <a class="brand" href="/" data-link>
          <span class="brand__mark" aria-hidden="true">♠</span>
          <span class="brand__name">Arena<em>Play</em></span>
          <span class="brand__badge" data-i18n="app.demo_badge">demo</span>
        </a>
        <nav class="nav" aria-label="${t('a11y.primary_nav')}">
          ${NAV.map((n) => html`<a href="${n.href}" data-link data-nav="${n.href}">${icon(n.icon, 18)}<span data-i18n="${n.key}">${t(n.key)}</span></a>`)}
        </nav>
        <div class="hdr__tools" id="hdr-tools"></div>
      </div>
    </header>
    <main id="main" tabindex="-1"></main>
    <footer class="ftr" role="contentinfo"><div class="container container--wide" id="ftr-inner"></div></footer>
    <nav class="tabbar" aria-label="${t('a11y.mobile_nav')}"><div class="tabbar__inner" id="tabbar"></div></nav>`);

  const burger = qs('#burger');
  burger.addEventListener('click', openDrawer);

  on(document, 'click', '[data-link]', (ev, a) => {
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0 || a.target) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('mailto')) return;
    ev.preventDefault();
    navigate(href);
  });
  document.addEventListener('click', (ev) => {
    const lang = ev.target.closest?.('[data-lang]');
    if (lang) { void switchLanguage(lang.dataset.lang); return; }
    const act = ev.target.closest?.('[data-act="logout"]');
    if (act) { ev.preventDefault(); void doLogout(); }
  });
  window.addEventListener('popstate', () => render());
  window.addEventListener('app:unauthorized', () => {
    if (state.user) {
      patch({ user: null, wallet: null }, 'session');
      void renderTools();
    }
  });
  window.addEventListener('unhandledrejection', (ev) => {
    if (ev.reason?.status === 401 || ev.reason?.isApiError) return; // already surfaced
    console.error('[unhandled]', ev.reason);
  });
  shellBuilt = true;
}

function renderFooter() {
  const groups = [
    { title: 'ftr.games', links: [['/casino', 'nav.casino'], ['/live', 'nav.live'], ['/sports', 'nav.sports'], ['/fairness', 'nav.fairness']] },
    { title: 'ftr.account', links: [['/account', 'nav.account'], ['/wallet', 'nav.wallet'], ['/history', 'nav.history'], ['/support', 'nav.support']] },
    { title: 'ftr.legal', links: [['/legal/terms', 'legal.terms'], ['/legal/privacy', 'legal.privacy'], ['/legal/gambling-help', 'legal.help'], ['/legal/responsible', 'legal.responsible']] },
  ];
  render(qs('#ftr-inner'), html`
    <div class="ftr__grid">
      <div>
        <div class="brand" style="margin-bottom:8px">
          <span class="brand__mark" aria-hidden="true">♠</span>
          <span class="brand__name">Arena<em>Play</em></span>
        </div>
        <p class="section__sub" data-i18n="ftr.tagline">${t('ftr.tagline')}</p>
        <div class="row" style="margin-top:10px"><span class="age-badge" aria-hidden="true">18+</span>
          <p class="section__sub grow" data-i18n="ftr.age_note">${t('ftr.age_note')}</p></div>
      </div>
      ${groups.map((g) => html`<div><h4 data-i18n="${g.title}">${t(g.title)}</h4>
        ${g.links.map(([href, key]) => html`<a href="${href}" data-link data-i18n="${key}">${t(key)}</a>`)}</div>`)}
    </div>
    <div class="ftr__legal">
      <p data-i18n="compliance.demo_disclaimer">${t('compliance.demo_disclaimer')}</p>
      <div class="row row--wrap row--between">
        <span>© ${new Date().getFullYear()} ArenaPlay · <span data-i18n="ftr.no_real_money">${t('ftr.no_real_money')}</span></span>
        <span class="row" style="gap:14px">
          <span class="chip chip--soft" id="ftr-conn">${isLiveConnected() ? t('live.connected') : t('live.reconnecting')}</span>
          <span class="chip chip--soft">${t('app.version')} ${state.boot?.version || '1.0.0'}</span>
        </span>
      </div>
    </div>`);
}

function renderTools() {
  const tools = qs('#hdr-tools');
  if (!tools) return;
  const u = state.user;
  const w = state.wallet;
  const unread = state.notifications?.unread || 0;
  render(tools, html`
    <form class="search grow hide-sm" role="search" action="/casino" data-search>
      <span class="search__icon">${icon('search', 16)}</span>
      <input class="input" type="search" name="q" inputmode="search" autocomplete="off"
        placeholder="${t('nav.search_ph')}" aria-label="${t('nav.search')}" value="${state.lobby.search || ''}" />
    </form>
    <div class="lang-switch" role="group" aria-label="${t('a11y.language')}">
      <button type="button" data-lang="en" aria-pressed="${!isBengali()}">EN</button>
      <button type="button" data-lang="bn" aria-pressed="${isBengali()}">বাং</button>
    </div>
    ${u ? html`
      <a class="icon-btn" href="/notifications" data-link aria-label="${t('nav.notifications')}${unread ? ` (${unread})` : ''}">
        ${icon('bell', 18)}${unread ? html`<span class="dot">${unread > 9 ? '9+' : unread}</span>` : ''}
      </a>
      <a class="wallet-chip" href="/wallet" data-link title="${t('wallet.title')}">
        <span class="grow" style="text-align:right">
          <span class="wallet-chip__amt">${fmtCreditsShort(w?.balance ?? 0)}</span>
          <span class="wallet-chip__cur" data-i18n="wallet.demo_currency">${t('wallet.demo_currency')}</span>
        </span>
        <span class="btn btn--sm btn--gold btn--icon" aria-hidden="true">+</span>
      </a>
      <button class="icon-btn" type="button" id="me-btn" aria-haspopup="true" aria-label="${t('nav.account')}">
        <span class="avatar avatar--sm">${(u.username || u.email)[0].toUpperCase()}</span>
      </button>` : html`
      <a class="btn btn--sm" href="/login" data-link>${t('auth.login')}</a>
      <a class="btn btn--sm btn--gold" href="/register" data-link>${t('auth.register')}</a>`}
    <button class="btn btn--sm btn--ghost only-sm" type="button" id="search-toggle" aria-label="${t('nav.search')}">${icon('search', 18)}</button>`);

  const search = tools.querySelector('[data-search]');
  search?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = encodeURIComponent(new FormData(search).get('q') || '');
    navigate(`/casino?q=${q}`);
  });
  tools.querySelector('#search-toggle')?.addEventListener('click', () => openSearch());
  tools.querySelector('#me-btn')?.addEventListener('click', openMeMenu);
}

const fmtCreditsShort = (cents) => {
  const n = (Number(cents) || 0) / 100;
  const s = n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toFixed(2);
  return isBengali() ? `৳${s.replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d])}` : `৳${s}`;
};

function openSearch() {
  const wrap = document.createElement('div');
  render(wrap, html`
    <form class="search" data-quick-search>
      <span class="search__icon">${icon('search', 16)}</span>
      <input class="input" name="q" type="search" placeholder="${t('nav.search_ph')}" aria-label="${t('nav.search')}" autocomplete="off" />
    </form>
    <div class="row row--wrap" style="margin-top:10px">
      ${(state.content?.categories || []).slice(0, 6).map((c) => html`<button class="btn-tab" type="button" data-cat="${c.key}" data-i18n="${c.nameKey}">${t(c.nameKey)}</button>`)}
    </div>`);
  const m = modal({ title: t('nav.search'), body: wrap });
  const input = wrap.querySelector('input');
  input.focus();
  wrap.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    m.close();
    navigate(`/casino?q=${encodeURIComponent(input.value || '')}`);
  });
  on(wrap, 'click', '[data-cat]', (ev, b) => { m.close(); navigate(`/casino/${b.dataset.cat}`); });
}

function openMeMenu() {
  const u = state.user;
  const items = [
    ['/account', 'nav.profile', 'user'],
    ['/wallet', 'nav.wallet', 'wallet'],
    ['/history', 'nav.history', 'clock'],
    ['/favorites', 'nav.favorites', 'star'],
    ['/responsible', 'nav.responsible', 'shield'],
    ['/support', 'nav.support', 'chat'],
    ['/settings', 'nav.settings', 'cog'],
  ];
  if (isStaff()) items.unshift(['/admin', 'nav.admin', 'shield']);
  const body = document.createElement('div');
  render(body, html`
    <div class="row" style="gap:12px;margin-bottom:12px">
      <span class="avatar avatar--lg">${(u.username || u.email)[0].toUpperCase()}</span>
      <div class="grow">
        <strong>${u.username || t('user.player')}</strong>
        <div class="section__sub">${u.email}</div>
        <div class="row" style="gap:6px;margin-top:6px">
          <span class="chip chip--soft">${t(`user.role.${u.role}`)}</span>
          <span class="chip ${u.status === 'active' ? 'chip--green' : 'chip--red'}">${t(`user.status.${u.status}`)}</span>
        </div>
      </div>
    </div>
    <div class="list-divided">
      ${items.map(([href, key, ic]) => html`<a class="row" href="${href}" data-link style="padding:6px 2px">${icon(ic, 17)}<span data-i18n="${key}">${t(key)}</span></a>`)}
      <button class="row btn btn--ghost" type="button" data-act="logout" style="justify-content:flex-start;color:var(--red)">${icon('logout', 17)}<span>${t('auth.logout')}</span></button>
    </div>`);
  const m = modal({ title: t('nav.account'), body });
  on(body, 'click', '[data-link]', (ev) => { ev.preventDefault(); m.close(); navigate(ev.target.closest('a').getAttribute('href')); });
}

function openDrawer() {
  const links = [
    { href: '/', key: 'nav.home', icon: 'home' },
    ...NAV,
    { href: '/account', key: 'nav.account', icon: 'user' },
    ...(isStaff() ? [{ href: '/admin', key: 'nav.admin', icon: 'shield' }] : []),
  ];
  const body = document.createElement('div');
  render(body, html`
    <nav aria-label="${t('a11y.primary_nav')}" class="stack">
      ${links.map((n) => html`<a href="${n.href}" data-link>${icon(n.icon, 19)}<span data-i18n="${n.key}">${t(n.key)}</span></a>`)}
    </nav>
    <hr />
    <div class="row row--wrap">
      <button class="btn-tab" type="button" data-lang="en" aria-pressed="${String(!isBengali())}">English</button>
      <button class="btn-tab" type="button" data-lang="bn" aria-pressed="${String(isBengali())}">বাংলা</button>
    </div>
    <hr />
    ${state.user ? html`<button class="btn btn--block" type="button" data-act="logout">${icon('logout', 16)}<span>${t('auth.logout')}</span></button>`
      : html`<a class="btn btn--block btn--gold" href="/login" data-link>${t('auth.login')}</a>`}
    <p class="section__sub" style="margin-top:12px">${t('compliance.demo_short')}</p>`);
  const d = drawer({ title: t('app.name'), body });
  on(body, 'click', '[data-link]', (ev, a) => { ev.preventDefault(); d.close(); navigate(a.getAttribute('href')); });
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
let renderInFlight = 0;

export async function renderRoute({ scroll = true } = {}) {
  const path = location.pathname === '/index.html' ? '/' : location.pathname;
  const url = new URL(location.href);
  const found = match(path);
  router.path = path;
  if (document.getElementById('boot-splash')) qs('#app').hidden = false;
  qs('#boot-splash')?.setAttribute('hidden', '');

  const main = qs('#main');
  if (!found) {
    history.replaceState(null, '', '/404');
    return renderRoute({ scroll: false });
  }
  const { route, params } = found;
  router.params = params;

  // Route guards — UI only; the API enforces the real rules.
  if ((route.auth || route.staff) && !state.user) {
    const next = encodeURIComponent(path + url.search);
    navigate(`/login?next=${next}`, { replace: true });
    return;
  }
  if (route.staff && !isStaff()) {
    render(main, html`<div class="container"><div class="panel"><div class="panel__body empty">
      <span class="empty__icon">${icon('shield', 30)}</span>
      <h2>${t('err.admin_only')}</h2><p class="section__sub">${t('err.admin_only_body')}</p>
      <a class="btn btn--gold" href="/" data-link>${t('btn.back_home')}</a></div></div></div>`);
    document.title = `${t('title.403')} · ${t('app.name')}`;
    return;
  }

  const token = ++router.token;
  typeof router.cleanup === 'function' && router.cleanup();
  router.cleanup = null;
  const ctx = {
    params,
    query: Object.fromEntries(url.searchParams.entries()),
    path,
    navigate,
    token: () => token,
    alive: () => router.token === token,
  };
  document.title = `${t('app.name')}`;
  render(main, html`<div class="container stack"><div class="skel skel--line"></div><div class="skel skel--card" style="height:180px"></div><div class="skel skel--line"></div></div>`);
  renderInFlight += 1;
  progressStart();
  let mod = null;
  try {
    mod = await loadPage(route.page);
    const cleanup = await mod.render(main, ctx, route);
    if (router.token !== token) { typeof cleanup === 'function' && cleanup(); return; }
    router.cleanup = cleanup;
    translateTree(main);
    if (route.tab) main.dataset.tab = route.tab;
    document.title = `${t(route.title)} · ${t('app.name')}`;
    markActive();
    if (scroll) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (err) {
    console.error('[route]', err);
    if (router.token === token) {
      render(main, html`<div class="container"><div class="panel"><div class="panel__body empty">
        <span class="empty__icon">${icon('warn', 30)}</span>
        <h2>${t('err.page_failed')}</h2>
        <p class="section__sub">${err?.message || ''}</p>
        <button class="btn btn--gold" type="button" data-reload>${t('btn.retry')}</button></div></div></div>`);
      main.querySelector('[data-reload]')?.addEventListener('click', () => render());
    }
  } finally {
    renderInFlight -= 1;
    if (renderInFlight <= 0) progressEnd();
  }
}

function markActive() {
  const path = router.path;
  for (const a of document.querySelectorAll('[data-nav], .tabbar a')) {
    const href = a.getAttribute('href');
    const active = href === '/' ? path === '/' : (href === '/casino' ? path.startsWith('/casino') || path.startsWith('/game') : path.startsWith(href));
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function switchLanguage(code) {
  if (code === locale()) return;
  await setLocale(code);
  toastOkLocale();
  await renderRoute({ scroll: false });
  renderTools();
  renderFooter();
  markActive();
}
const toastOkLocale = () => toast(t('lang.switched', { lang: t(isBengali() ? 'lang.bn' : 'lang.en') }), { type: 'success', duration: 2600 });

async function doLogout() {
  try { await api.post('/auth/logout'); } catch { /* already gone */ }
  patch({ user: null, wallet: null, favorites: [], notifications: { rows: [], unread: 0 } }, 'session');
  renderTools();
  navigate('/');
  toast(t('auth.logged_out'), { type: 'success' });
}

// ---------------------------------------------------------------------------
// Live wiring
// ---------------------------------------------------------------------------
function wireLive() {
  onLive('notification', () => { refreshNotifications(); });
  onLive('wallet:update', (p) => {
    if (!p || p.userId !== state.user?.id) return;
    patch({ wallet: { ...(state.wallet || {}), balance: p.balance, lifetimeWagered: p.lifetimeWagered, lifetimeWon: p.lifetimeWon, netResult: p.netResult, currency: p.currency, updatedAt: p.updatedAt } }, 'wallet');
  });
  onLive('bet:settled', (p) => {
    api.invalidate('/wallet');
    if (p?.gameKey) api.invalidate(`/bets?gameKey=${p.gameKey}`);
    const settledId = p?.publicId ?? p?.betId ?? null;
    if (state.betStatus?.id && settledId && String(state.betStatus.id) === String(settledId)) patch({ betStatus: { ...state.betStatus, status: p.status } }, 'betStatus');
  });
  onLive('bet:opened', (p) => {
    if (p?.userId && p.userId !== state.user?.id) return;
    const openedId = p?.id ?? p?.betId ?? null;
    if (openedId) patch({ betStatus: { id: openedId, gameKey: p.gameKey, status: 'pending', bet: p } }, 'betStatus');
  });
  subscribe((what) => { if (what === 'session' || what === 'wallet' || what === 'notifications') { renderTools(); } });
  every(60000, () => { refreshNotifications(); });
  every(15000, () => { const c = qs('#ftr-conn'); if (c) c.textContent = isLiveConnected() ? t('live.connected') : t('live.reconnecting'); });
}

// Reality check / session timer (responsible gaming, spec §5 + §6).
function wireRealityCheck() {
  const minutes = state.boot?.limits?.realityCheckEveryMin || 0;
  if (!minutes) return;
  const ms = minutes * 60000;
  const check = async () => {
    if (!state.user || state.session.realityCheckShown) return;
    const elapsed = Date.now() - state.session.startedAt;
    if (elapsed < ms) return;
    patch({ session: { ...state.session, realityCheckShown: true } });
    let s = null;
    try { s = await api.get('/rg/status'); } catch { return; }
    modal({
      title: t('rg.reality_title'),
      body: html`
        <div class="stack">
          <div class="notice notice--gold">${icon('info', 18)}<div>${t('rg.demo_notice')}</div></div>
          <dl class="kv">
            <dt>${t('rg.session_time')}</dt><dd>${Math.round(s.session?.minutes || elapsed / 60000)} ${t('unit.min')}</dd>
            <dt>${t('rg.net_today')}</dt><dd>${fmtCreditsShort(-s.todayNet ?? 0)}</dd>
            <dt>${t('rg.bets_today')}</dt><dd>${s.todayBets ?? 0}</dd>
          </dl>
          <p class="section__sub">${t('rg.reality_body')}</p>
        </div>`,
      actions: [
        { label: t('rg.take_break'), variant: 'gold', onClick: () => { navigate('/responsible'); } },
        { label: t('btn.continue') },
      ],
    });
  };
  every(30000, check);
}

// ---------------------------------------------------------------------------
export async function boot() {
  const bootData = state.boot || {};
  const locale = preferredLocale(bootData.locale);
  await loadLocale(locale);
  // Keep English + Bangla catalogues resident so switching is instant and never
  // leaves half-translated text behind.
  await loadLocale(locale === 'bn' ? 'en' : 'bn');
  shell();
  renderFooter();
  if (bootData.csrf) api.setCsrf(bootData.csrf);
  if (bootData.user) {
    patch({
      user: bootData.user,
      wallet: bootData.wallet ?? null,
      csrf: bootData.csrf ?? null,
      favorites: bootData.favorites || [],
      notifications: bootData.notifications || { rows: [], unread: 0 },
      session: { authenticated: true, startedAt: Date.now(), realityCheckShown: false },
    }, 'session');
  }
  if (bootData.maintenance && !state.user) {
    render(qs('#main'), html`<div class="container"><div class="panel"><div class="panel__body empty">
      <h2>${t('err.maintenance')}</h2><p class="section__sub">${t('err.maintenance_body')}</p></div></div></div>`);
  }
  renderTools();
  try { await refreshContent(); } catch { /* offline banner covers it */ }
  void refreshNotifications();
  connectLive();
  wireLive();
  wireRealityCheck();
  await renderRoute();
  document.body.dataset.ready = '1';
}

if (typeof window !== 'undefined') {
  window.App = { navigate, render: renderRoute, state, toast, modal, t };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
}

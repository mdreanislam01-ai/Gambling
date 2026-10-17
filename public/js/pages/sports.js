/** Sports board: cricket + football fixtures, demo odds, bet slip, live updates. */
import { html, render as paint, icon } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtOdds, fmtDateTime, fmtCountdown, fmtDateShort, isBengali } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshWallet } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, every, modal } from '../core/ui.js';
import { on as onLive } from '../core/sse.js';
import { emptyState, demoNotice } from '../components/widgets.js';

const SPORTS = [
  { key: null, labelKey: 'sports.all' },
  { key: 'cricket', labelKey: 'sports.cricket' },
  { key: 'football', labelKey: 'sports.football' },
];
const STATUS = [
  { key: 'live', labelKey: 'sports.tab_live' },
  { key: 'today', labelKey: 'sports.tab_today' },
  { key: 'upcoming', labelKey: 'sports.tab_upcoming' },
  { key: 'results', labelKey: 'sports.tab_results' },
];

export async function render(root, ctx) {
  const isMatch = ctx.path.startsWith('/sports/match/');
  paint(root, html`<div class="container container--wide stack">
    <div data-role="body"></div>
    <aside class="panel" data-role="slip-drawer" hidden></aside>
  </div>`);
  const body = root.querySelector('[data-role=body]');
  const view = isMatch ? matchView(body, ctx) : boardView(body, ctx);
  await view.mount();
  const stop = every(1000, () => {
    for (const n of root.querySelectorAll('[data-countdown]')) {
      const target = Number(n.dataset.countdown);
      if (target) n.textContent = fmtCountdown(target);
    }
  });
  return () => { view.stop?.(); stop(); };
}

// ---------------------------------------------------------------------------
// Bet slip (shared by board + match views)
// ---------------------------------------------------------------------------
const slip = {
  legs: [],
  stake: 500,
  type: 'single',
  host: null,
  onChange: () => {},
  add(sel) {
    if (this.legs.some((l) => l.selectionId === sel.selectionId)) { this.remove(sel.selectionId); return; }
    if (this.legs.length >= 12) { toast(t('sports.slip_full')); return; }
    this.legs.push(sel);
    this.onChange();
  },
  remove(id) { this.legs = this.legs.filter((l) => l.selectionId !== id); this.onChange(); },
  clear() { this.legs = []; this.onChange(); },
  has(id) { return this.legs.some((l) => l.selectionId === id); },
  get totalOdds() { return this.legs.reduce((a, l) => a * (l.oddsBps / 10000), 1); },
  get totalStake() { return this.type === 'multi' ? this.stake : this.stake * Math.max(1, this.legs.length); },
  get potential() { return this.type === 'multi' ? Math.floor(this.stake * this.totalOdds) : this.legs.reduce((a, l) => a + Math.floor(this.stake * l.oddsBps / 10000), 0); },
};

function mountSlip(host, onPlaced) {
  slip.host = host;
  slip.onChange = () => paintSlip();
  paintSlip();
  function paintSlip() {
    if (!host) return;
    const legs = slip.legs;
    const open = legs.length > 0 && !!slip.stake;
    paint(host, html`
      <div class="panel__head">${icon('ticket', 16)}<h3>${t('sports.slip')}</h3>
        <span class="chip chip--soft">${fmtNum(legs.length)}</span>
        <span class="grow"></span>
        ${legs.length ? html`<button class="btn btn--sm btn--ghost" type="button" data-slip="clear">${t('btn.clear')}</button>` : ''}</div>
      <div class="panel__body slip">
        ${legs.length ? html`
          <div class="row" style="gap:6px">
            <button class="btn-tab" type="button" data-slip="type" data-type="single" aria-selected="${String(slip.type === 'single')}">${t('sports.single')}</button>
            <button class="btn-tab" type="button" data-slip="type" data-type="multi" aria-selected="${String(slip.type === 'multi') && legs.length > 1}">${t('sports.multi')}</button>
          </div>
          ${legs.map((l) => html`
            <div class="slip__leg">
              <div class="grow"><strong>${l.selection}</strong>
                <div class="section__sub" style="font-size:.74rem">${l.home} — ${l.away}</div>
                <div class="section__sub" style="font-size:.74rem">${l.market}</div></div>
              <div class="row" style="gap:6px;align-items:flex-start">
                <b>${fmtOdds(l.oddsBps)}</b>
                <button class="btn btn--sm btn--ghost" type="button" data-slip="rm" data-id="${l.selectionId}" aria-label="${t('btn.remove')}">${icon('close', 13)}</button>
              </div>
            </div>`)}
          <div class="field">
            <label class="field__label" for="slip-stake">${t('bet.stake')}${slip.type === 'single' ? html` <span class="section__sub">${t('sports.per_leg')}</span>` : ''}</label>
            <div class="input-group"><span class="suffix">৳</span>
              <input class="input" id="slip-stake" type="number" min="1" step="1" value="${(slip.stake / 100).toFixed(2)}" />
              ${[500, 1000, 5000].map((c) => html`<button class="btn btn--sm" type="button" data-slip="chip" data-c="${c}">${fmtNum(c / 100)}</button>`)}
            </div>
          </div>
          <div>
            <div class="slip__sum"><span>${t('sports.total_stake')}</span><strong>${fmtCredits(slip.totalStake)}</strong></div>
            <div class="slip__sum"><span>${t('sports.total_odds')}</span><strong>${slip.type === 'multi' ? fmtOdds(Math.round(slip.totalOdds * 10000)) : '—'}</strong></div>
            <div class="slip__sum"><span>${t('sports.potential')}</span><strong style="color:var(--green)">${fmtCredits(slip.potential)}</strong></div>
          </div>
          <button class="btn btn--gold btn--block btn--lg" type="button" data-slip="place" ${open ? '' : 'disabled'}>${t('sports.place_bet')}</button>
          <p class="section__sub center">${t('sports.slip_demo_note')}</p>`
        : html`
          <div class="empty" style="padding:18px 0">
            <span class="empty__icon">${icon('ticket', 26)}</span>
            <p class="section__sub">${t('sports.slip_empty')}</p>
          </div>`}
      </div>`);
    host.querySelectorAll('[data-slip=rm]').forEach((b) => b.addEventListener('click', () => slip.remove(Number(b.dataset.id))));
    host.querySelector('[data-slip=clear]')?.addEventListener('click', () => slip.clear());
    host.querySelectorAll('[data-slip=type]').forEach((b) => b.addEventListener('click', () => { slip.type = b.dataset.type; paintSlip(); }));
    host.querySelectorAll('[data-slip=chip]').forEach((b) => b.addEventListener('click', () => { slip.stake = Number(b.dataset.c); paintSlip(); }));
    host.querySelector('#slip-stake')?.addEventListener('input', (ev) => { slip.stake = Math.max(100, Math.round((Number(ev.target.value) || 0) * 100)); paintSum(); });
    host.querySelector('[data-slip=place]')?.addEventListener('click', place);
  }
  function paintSum() {
    const sums = host.querySelectorAll('.slip__sum');
    if (sums.length === 3) {
      sums[0].querySelector('strong').textContent = fmtCredits(slip.totalStake);
      sums[1].querySelector('strong').textContent = slip.type === 'multi' ? fmtOdds(Math.round(slip.totalOdds * 10000)) : '—';
      sums[2].querySelector('strong').textContent = fmtCredits(slip.potential);
    }
  }
  async function place() {
    if (!state.user) { navigate(`/login?next=${encodeURIComponent(location.pathname)}`); return; }
    const btn = host.querySelector('[data-slip=place]');
    btn.disabled = true;
    try {
      const out = await api.post('/sports/bet', {
        legs: slip.legs.map((l) => ({ selectionId: l.selectionId })),
        stakeCents: slip.stake,
        slipType: slip.type,
      });
      if (out.wallet) patch({ wallet: out.wallet }, 'wallet'); else refreshWallet();
      const n = out.bets?.length || 1;
      modal({
        title: t('sports.bet_placed'),
        body: html`<div class="stack">
          <div class="notice notice--info">${icon('check', 18)}<div>${t('sports.bet_placed_body', { count: fmtNum(n), stake: fmtCredits(out.totalStake) })}</div></div>
          <dl class="kv">
            <dt>${t('sports.total_stake')}</dt><dd>${fmtCredits(out.totalStake)}</dd>
            <dt>${t('sports.total_odds')}</dt><dd>${fmtOdds(Math.round(out.totalOdds * 10000))}</dd>
            <dt>${t('sports.potential')}</dt><dd>${fmtCredits(out.potentialReturn)}</dd>
          </dl>
          <div class="paytable">${(out.bets || []).map((b) => html`<div><span class="mono">${b.id}</span><b>${t(`bet.status.${b.status}`)}</b></div>`)}</div>
        </div>`,
        actions: [{ label: t('btn.close') }, { label: t('btn.view_history'), variant: 'gold', onClick: () => navigate('/history') }],
      });
      slip.clear();
      onPlaced?.();
    } catch (err) {
      toastError(err);
    } finally { btn.disabled = false; }
  }
  return { repaint: paintSlip };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------
function boardView(host, ctx) {
  const st = {
    sport: ctx.params.sport || null,
    status: ctx.query.status || 'upcoming',
    q: ctx.query.q || '',
    league: Number(ctx.query.league) || null,
    rows: [], leagues: [], total: 0, loading: true, liveData: false, error: null,
  };
  let offs = [];
  let stopTick = null;

  async function mount() {
    paint(host, html`
      <div class="section__head">
        <div class="grow"><h1 class="section__title">${t('sports.title')}</h1><p class="section__sub">${t('sports.sub')}</p></div>
        <span class="chip chip--soft" data-role="provider">…</span>
      </div>
      <div class="layout-lobby">
        <aside class="layout-lobby__side stack" aria-label="${t('sports.filters')}">
          <div class="panel"><div class="panel__body stack">
            <div class="field"><span class="field__label">${t('sports.sport')}</span>
              <div class="col" style="gap:4px">${SPORTS.map((sp) => html`
                <button class="btn-tab" type="button" data-sport="${sp.key || ''}" aria-selected="${String((sp.key || null) === st.sport)}" style="justify-content:flex-start">
                  ${sp.key === 'cricket' ? '🏏' : sp.key === 'football' ? '⚽' : '🏟️'} <span data-i18n="${sp.labelKey}">${t(sp.labelKey)}</span></button>`)}
              </div></div>
            <div class="field"><span class="field__label">${t('sports.when')}</span>
              <div class="col" style="gap:4px">${STATUS.map((s) => html`
                <button class="btn-tab" type="button" data-status="${s.key}" aria-selected="${String(s.key === st.status)}" style="justify-content:flex-start">
                  <span data-i18n="${s.labelKey}">${t(s.labelKey)}</span></button>`)}
              </div></div>
            <div class="field"><label class="field__label" for="league-sel">${t('sports.league')}</label>
              <select class="select" id="league-sel" data-league><option value="">${t('sports.all_leagues')}</option></select></div>
          </div></div>
        </aside>
        <div class="stack">
          <div class="search"><span class="search__icon">${icon('search', 16)}</span>
            <input class="input" data-q type="search" placeholder="${t('sports.search_ph')}" aria-label="${t('sports.search')}" value="${st.q}" /></div>
          <div data-role="list" aria-live="polite"></div>
        </div>
        <aside class="layout-lobby__side stack">
          <div data-role="slip"></div>
          <section class="panel"><div class="panel__head">${icon('chart', 16)}<h3>${t('sports.status.label')}</h3></div>
            <div class="panel__body stack" data-role="status"></div></section>
          ${demoNotice('sports.demo_notice')}
        </aside>
      </div>`);
    mountSlip(host.querySelector('[data-role=slip]'), load);
    host.querySelector('[data-q]')?.addEventListener('input', debounced((v) => { st.q = v.trim(); load(); }));
    host.querySelectorAll('[data-sport]').forEach((b) => b.addEventListener('click', () => { st.sport = b.dataset.sport || null; host.querySelectorAll('[data-sport]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); load(); }));
    host.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { st.status = b.dataset.status; host.querySelectorAll('[data-status]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); load(); }));
    host.querySelector('[data-league]')?.addEventListener('change', (ev) => { st.league = Number(ev.target.value) || null; load(); });
    await load();
    await status();
    const apply = (p) => {
      const row = host.querySelector(`[data-fixture="${p.fixtureId}"]`);
      if (!row) return;
      const score = row.querySelector('[data-role=score]');
      if (score) score.textContent = `${fmtNum(p.home ?? 0)} : ${fmtNum(p.away ?? 0)}`;
      const min = row.querySelector('[data-role=minute]');
      if (min) min.textContent = p.status === 'live' ? t('sports.minute', { minute: fmtNum(p.minute || 0) }) : t(`sports.status.${p.status}`);
      row.classList.toggle('is-live', p.status === 'live');
    };
    offs = [onLive('sports:update', apply), onLive('sports:settled', () => load())];
    stopTick = every(20000, () => { if (!document.hidden) load(); });
  }

  async function status() {
    try {
      const s = await api.cached('/sports/status', 60000);
      paint(host.querySelector('[data-role=provider]'), html`
        <span class="chip ${s.liveData ? 'chip--green' : 'chip--soft'}">${s.liveData ? t('sports.provider_live') : t('sports.demo_label')}</span>`);
      paint(host.querySelector('[data-role=status]'), html`
        <dl class="kv">
          <dt>${t('sports.provider')}</dt><dd>${s.provider || 'none'}</dd>
          <dt>${t('sports.live_feed')}</dt><dd>${s.liveData ? t('btn.yes') : t('btn.no')}</dd>
          <dt>${t('sports.demo_fixtures')}</dt><dd>${fmtNum(s.demoFixtures)}</dd>
          <dt>${t('sports.provider_fixtures')}</dt><dd>${fmtNum(s.providerFixtures)}</dd>
          <dt>${t('sports.refresh')}</dt><dd>${fmtNum(s.refreshSeconds)}s</dd>
        </dl>
        <p class="section__sub">${t(s.explanationKey || 'sports.demo_only')}</p>
        ${state.user?.role === 'admin' ? html`<button class="btn btn--sm" type="button" data-pull>${t('sports.pull_provider')}</button>` : ''}`);
      host.querySelector('[data-pull]')?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try { const r = await api.post('/sports/refresh'); toast(r.ok ? t('sports.pull_ok', { count: fmtNum(r.updated) }) : t('sports.pull_failed', { reason: r.reason || '—' })); await load(); }
        catch (err) { toastError(err); } finally { ev.currentTarget.disabled = false; }
      });
    } catch { /* offline */ }
  }

  async function load() {
    st.loading = true;
    paintList();
    const params = new URLSearchParams();
    if (st.sport) params.set('sport', st.sport);
    if (st.status) params.set('status', st.status);
    if (st.q) params.set('q', st.q);
    if (st.league) params.set('leagueId', String(st.league));
    params.set('limit', '40');
    try {
      const data = await api.get(`/sports/fixtures?${params}`);
      st.rows = data.rows || [];
      st.total = data.total || 0;
      st.liveData = !!data.liveData;
      st.leagues = data.leagues || [];
      st.error = null;
      const sel = host.querySelector('[data-league]');
      if (sel) {
        sel.innerHTML = `<option value="">${t('sports.all_leagues')}</option>` + st.leagues.map((l) => `<option value="${l.id}">${esc(isBengali() && l.nameKey ? t(l.nameKey) : l.name)}</option>`).join('');
        if (st.league) sel.value = String(st.league);
      }
    } catch (err) {
      st.error = err;
      st.loading = false;
    }
    st.loading = false;
    paintList();
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const debounced = (fn, ms = 300) => { let id; return (v) => { clearTimeout(id); id = setTimeout(() => fn(v), ms); }; };

  function paintList() {
    const listHost = host.querySelector('[data-role=list]');
    if (!listHost) return;
    if (st.loading && !st.rows.length) { paint(listHost, html`<div class="stack">${Array.from({ length: 5 }, () => html`<div class="skel skel--line" style="height:92px"></div>`)}</div>`); return; }
    if (st.error) { paint(listHost, emptyState({ icon: 'warn', titleKey: 'err.load_fixtures', bodyKey: 'err.load_fixtures_body' })); return; }
    if (!st.rows.length) { paint(listHost, emptyState({ icon: 'sports', titleKey: 'sports.none', bodyKey: 'sports.none_body' })); return; }
    const groups = new Map();
    for (const f of st.rows) {
      const k = f.league?.name || t('sports.other');
      if (!groups.has(k)) groups.set(k, { league: f.league, rows: [] });
      groups.get(k).rows.push(f);
    }
    paint(listHost, html`
      <div class="stack">
        <div class="row row--between"><span class="section__sub">${t('sports.showing', { count: fmtNum(st.rows.length), total: fmtNum(st.total) })}</span>
          <span class="chip chip--soft">${st.liveData ? t('sports.provider_live') : t('sports.demo_label')}</span></div>
        ${[...groups.entries()].map(([name, g]) => html`
          <section class="panel">
            <div class="panel__head">${g.league?.flag ? html`<span aria-hidden="true">${g.league.flag}</span>` : icon('trophy', 15)}
              <h3>${esc(name)}</h3><span class="grow"></span>
              <span class="chip chip--soft">${fmtNum(g.rows.length)}</span></div>
            <div class="panel__body panel__body--tight stack">
              ${g.rows.map((f) => fixtureRow(f))}
            </div>
          </section>`)}
      </div>`);
    wireList(listHost);
  }

  function fixtureRow(f) {
    const kickoff = parseKickoff(f.kickoff);
    const markets = (f.markets || []).slice(0, 3);
    return html`
      <article class="match" data-fixture="${f.id}" data-status="${f.status}">
        <div class="match__teams">
          <div class="match__meta">
            ${f.sport === 'cricket' ? '🏏' : '⚽'}
            <span data-i18n="sports.status.${f.status}">${t(`sports.status.${f.status}`)}</span>
            ${f.status === 'live' ? html`<span class="chip chip--red chip--live" data-role=minute>${t('sports.minute', { minute: fmtNum(f.minute || 0) })}</span>`
    : f.status === 'scheduled' ? html`<span data-countdown="${kickoff}">${fmtCountdown(kickoff)}</span>` : ''}
            <span>·</span><span>${fmtDateShort(f.kickoff)} ${timeOf(f.kickoff)}</span>
            ${f.simulated ? html`<span class="chip chip--soft">${t('sports.demo_label')}</span>` : ''}
          </div>
          <div class="match__team"><span class="grow">${f.home?.name || ''}</span>
            ${f.status !== 'scheduled' ? html`<b class="match__score" data-role=home>${fmtNum(f.score?.home ?? 0)}</b>` : ''}</div>
          <div class="match__team"><span class="grow">${f.away?.name || ''}</span>
            ${f.status !== 'scheduled' ? html`<b class="match__score" data-role=away>${fmtNum(f.score?.away ?? 0)}</b>` : ''}</div>
          ${f.status !== 'scheduled' ? html`<div class="match__meta"><span data-role=score>${fmtNum(f.score?.home ?? 0)} : ${fmtNum(f.score?.away ?? 0)}</span></div>` : ''}
        </div>
        <div class="col" style="gap:6px;min-width:min(100%,240px)">
          ${markets.length ? markets.map((m) => html`
            <div>
              <div class="section__sub" style="font-size:.7rem;margin-bottom:3px">${m.labelKey ? t(m.labelKey) : m.label}</div>
              <div class="odds-grid">
                ${m.selections.slice(0, 3).map((sel) => oddsButton(sel, f))}
              </div>
            </div>`) : html`<a class="btn btn--sm" href="/sports/match/${f.id}" data-link>${t('btn.open_match')}</a>`}
          <a class="section__sub" href="/sports/match/${f.id}" data-link style="text-align:right">${t('btn.all_markets', { count: fmtNum(f.markets?.length || 0) })}${icon('arrow', 13)}</a>
        </div>
      </article>`;
  }

  function oddsButton(sel, f) {
    const pressed = slip.has(sel.id);
    return html`
      <button class="odd-btn ${sel.status !== 'open' ? 'odd-btn--suspended' : ''}" type="button" data-sel="${sel.id}"
        aria-pressed="${String(pressed)}" ${sel.status !== 'open' ? 'disabled' : ''}>
        <span class="odd-btn__label">${sel.labelKey ? t(sel.labelKey, { home: f.home?.name, away: f.away?.name }) : sel.label}</span>
        <span class="odd-btn__odds">${fmtOdds(sel.oddsBps)}</span>
      </button>`;
  }

  function wireList(listHost) {
    listHost.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.sel);
      const row = b.closest('[data-fixture]');
      const f = st.rows.find((x) => String(x.id) === row.dataset.fixture);
      const sel = (f?.markets || []).flatMap((m) => m.selections).find((s) => s.id === id);
      if (!sel) return;
      const leg = {
        selectionId: sel.id,
        selection: sel.labelKey ? t(sel.labelKey, { home: f.home?.name, away: f.away?.name }) : sel.label,
        market: (f.markets.find((m) => m.selections.some((x) => x.id === id)) || {}).label || '',
        oddsBps: sel.oddsBps,
        home: f.home?.name, away: f.away?.name, fixtureId: f.id,
      };
      slip.add(leg);
      b.setAttribute('aria-pressed', String(slip.has(id)));
    }));
  }

  return { mount, stop: () => { offs.forEach((f) => f()); stopTick?.(); } };
}

const parseKickoff = (v) => {
  if (!v) return Date.now();
  const s = String(v).replace(' ', 'T');
  const ms = Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  return Number.isNaN(ms) ? Date.now() : ms;
};
const timeOf = (v) => {
  const d = new Date(parseKickoff(v));
  try { return new Intl.DateTimeFormat(isBengali() ? 'bn-BD' : 'en-US', { hour: '2-digit', minute: '2-digit' }).format(d); } catch { return ''; }
};

// ---------------------------------------------------------------------------
// Match detail
// ---------------------------------------------------------------------------
function matchView(host, ctx) {
  let offs = [];
  let stop = null;
  async function mount() {
    const id = ctx.params.id;
    paint(host, html`<div class="stack"><div class="skel skel--card" style="height:200px"></div><div class="skel skel--line"></div></div>`);
    let data;
    try { data = await api.get(`/sports/fixtures/${id}`); } catch (err) {
      paint(host, emptyState({ icon: 'warn', titleKey: err?.code || 'sports.fixture_not_found', bodyKey: '', action: html`<a class="btn btn--gold" href="/sports" data-link>${t('btn.back_board')}</a>` }));
      return;
    }
    const f = data.fixture;
    paint(host, html`
      <nav class="row" aria-label="${t('a11y.crumbs')}" style="font-size:.8rem;color:var(--muted)">
        <a href="/sports" data-link>${t('nav.sports')}</a><span>/</span><span>${f.league?.name || ''}</span>
      </nav>
      <div class="layout-lobby">
        <div class="stack" style="grid-column:1/-1">
          <section class="panel">
            <div class="panel__body">
              <div class="row row--wrap" style="gap:8px;margin-bottom:8px">
                <span class="chip chip--soft">${f.sport === 'cricket' ? '🏏 ' + t('sports.cricket') : '⚽ ' + t('sports.football')}</span>
                <span class="chip ${f.status === 'live' ? 'chip--red chip--live' : 'chip--soft'}">${t(`sports.status.${f.status}`)}</span>
                ${f.simulated ? html`<span class="chip chip--gold">${t('sports.demo_label')}</span>` : ''}
                <span class="grow"></span>
                <span class="section__sub">${fmtDateTime(f.kickoff)} · ${f.venue || ''}</span>
              </div>
              <div class="grid-3" style="align-items:center">
                <div class="center"><div style="font-size:1.5rem;font-weight:800">${f.home?.name || ''}</div><div class="section__sub">${t('sports.home')}</div></div>
                <div class="scoreline"><div class="scoreline__score" data-role=score>${fmtNum(f.score?.home ?? 0)} : ${fmtNum(f.score?.away ?? 0)}</div>
                  <div class="section__sub" data-role=minute>${f.status === 'live' ? t('sports.minute', { minute: fmtNum(f.minute || 0) }) : (f.status === 'scheduled' ? html`<span data-countdown="${parseKickoff(f.kickoff)}">${fmtCountdown(parseKickoff(f.kickoff))}</span>` : t('sports.final'))}</div></div>
                <div class="center"><div style="font-size:1.5rem;font-weight:800">${f.away?.name || ''}</div><div class="section__sub">${t('sports.away')}</div></div>
              </div>
              ${f.sport === 'cricket' && f.status !== 'scheduled' ? html`
                <div class="pitch" style="margin-top:12px;min-height:120px"><div class="pitch__lines"></div><div class="pitch__centre"></div>
                  <div class="row" style="gap:14px;z-index:1"><span class="chip chip--soft">${t('sports.over')}: ${fmtNum(Math.floor((f.minute || 0) / 5))}</span>
                    <span class="chip chip--soft">${t('app.demo_badge')}</span></div></div>` : ''}
            </div>
          </section>

          <div class="layout-game">
            <div class="stack">
              ${(f.marketList || f.markets || []).length ? (f.marketList || f.markets).map((m) => html`
                <section class="panel">
                  <div class="panel__head"><h3>${m.labelKey ? t(m.labelKey) : m.label}</h3>
                    <span class="grow"></span><span class="chip chip--soft ${m.status === 'open' ? 'chip--green' : 'chip--red'}">${t(`sports.market.${m.status}`)}</span></div>
                  <div class="panel__body"><div class="odds-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
                    ${m.selections.map((sel) => html`
                      <button class="odd-btn ${sel.status !== 'open' ? 'odd-btn--suspended' : ''}" type="button" data-sel="${sel.id}" aria-pressed="${String(slip.has(sel.id))}" ${sel.status !== 'open' ? 'disabled' : ''}>
                        <span class="odd-btn__label">${sel.labelKey ? t(sel.labelKey, { home: f.home?.name, away: f.away?.name }) : sel.label}</span>
                        <span class="odd-btn__odds">${fmtOdds(sel.oddsBps)}</span></button>`)}
                  </div></div>
                </section>`) : emptyState({ icon: 'sports', titleKey: 'sports.no_markets', bodyKey: 'sports.no_markets_body' })}
            </div>
            <aside class="layout-game__side stack">
              <div data-role="slip"></div>
              <section class="panel"><div class="panel__head">${icon('clock', 16)}<h3>${t('sports.my_bets')}</h3></div>
                <div class="panel__body panel__body--tight">
                  ${(data.myBets || []).length ? html`<div class="list-divided">
                    ${data.myBets.map((b) => html`<div class="row" style="gap:8px">
                      <span class="badge badge--${b.status}">${t(`bet.status.${b.status}`)}</span>
                      <span class="grow" style="font-size:.8rem">${b.selection?.legs?.[0]?.label || b.selection?.type || ''}
                        <div class="section__sub mono" style="font-size:.72rem">${b.public_id}</div></span>
                      <span class="mono" style="font-size:.82rem">${fmtCredits(b.payout > b.stake ? b.payout : b.stake)}</span></div>`)}
                  </div>` : html`<p class="section__sub">${t('sports.no_bets')}</p>`}
                </div></section>
              ${demoNotice('sports.demo_notice')}
            </aside>
          </div>
        </div>
      </div>`);
    mountSlip(host.querySelector('[data-role=slip]'), () => mount());
    host.querySelectorAll('[data-sel]').forEach((b) => b.addEventListener('click', () => {
      const selId = Number(b.dataset.sel);
      const sel = f.markets.flatMap((m) => m.selections.map((x) => ({ ...x, market: m }))).find((x) => x.id === selId);
      if (!sel) return;
      slip.add({
        selectionId: sel.id,
        selection: sel.labelKey ? t(sel.labelKey, { home: f.home?.name, away: f.away?.name }) : sel.label,
        market: sel.market.labelKey ? t(sel.market.labelKey) : sel.market.label,
        oddsBps: sel.oddsBps, home: f.home?.name, away: f.away?.name, fixtureId: f.id,
      });
      b.setAttribute('aria-pressed', String(slip.has(selId)));
    }));
    offs = [onLive('sports:update', (p) => {
      if (Number(p?.fixtureId) !== Number(f.id)) return;
      host.querySelector('[data-role=score]').textContent = `${fmtNum(p.home ?? 0)} : ${fmtNum(p.away ?? 0)}`;
      const min = host.querySelector('[data-role=minute]');
      if (min) min.textContent = t('sports.minute', { minute: fmtNum(p.minute || 0) });
    }), onLive('sports:settled', (p) => { if (Number(p?.fixtureId) === Number(f.id)) mount(); })];
    stop = every(25000, () => mount());
  }
  return { mount, stop: () => { offs.forEach((o) => o()); stop?.(); } };
}

/** Account area: profile, wallet, history, favourites, notifications, RG, support, settings. */
import { html, raw, render as paint, icon, on } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtDateTime, fmtRelative, fmtMultiplier, fmtPercent, isBengali, setLocale, locale } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshSession, refreshWallet, refreshFavorites, refreshNotifications } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, modal, confirmDialog, every } from '../core/ui.js';
import { buildForm } from '../forms.js';
import { dataTable, emptyState, demoNotice, kpiGrid, barChart, gameGrid, skeletonGrid } from '../components/widgets.js';

const AVATARS = ['tiger', 'lion', 'eagle', 'cobra', 'royal', 'flame', 'moon', 'star', 'bolt', 'shield'];
const AVATAR_GLYPH = { tiger: '🐯', lion: '🦁', eagle: '🦅', cobra: '🐍', royal: '👑', flame: '🔥', moon: '🌙', star: '⭐', bolt: '⚡', shield: '🛡️' };

const TABS = [
  { key: 'profile', labelKey: 'nav.profile', icon: 'user' },
  { key: 'wallet', labelKey: 'nav.wallet', icon: 'wallet' },
  { key: 'history', labelKey: 'nav.history', icon: 'clock' },
  { key: 'favorites', labelKey: 'nav.favorites', icon: 'star' },
  { key: 'notifications', labelKey: 'nav.notifications', icon: 'bell' },
  { key: 'responsible', labelKey: 'nav.responsible', icon: 'shield' },
  { key: 'support', labelKey: 'nav.support', icon: 'chat' },
  { key: 'settings', labelKey: 'nav.settings', icon: 'cog' },
];

export async function render(root, ctx) {
  const tab = ctx.params.tab || ctx.query.tab || 'profile';
  const current = TABS.some((x) => x.key === tab) ? tab : 'profile';
  paint(root, html`
    <div class="container container--wide stack">
      <header class="row row--wrap" style="gap:12px;align-items:flex-end">
        <div class="row" style="gap:12px">
          <span class="avatar avatar--lg" aria-hidden="true">${AVATAR_GLYPH[state.user?.avatar] || '⭐'}</span>
          <div><h1 style="margin:0">${state.user?.username || t('user.player')}</h1>
            <div class="row" style="gap:6px;color:var(--muted);font-size:.84rem">
              <span>${state.user?.email}</span><span>·</span>
              <span class="chip chip--soft">${t(`user.role.${state.user?.role || 'player'}`)}</span>
              <span class="chip ${state.user?.status === 'active' ? 'chip--green' : 'chip--red'}">${t(`user.status.${state.user?.status || 'active'}`)}</span>
              ${state.user?.selfExclusionUntil ? html`<span class="chip chip--red">${t('rg.excluded_until', { date: fmtDateTime(state.user.selfExclusionUntil) })}</span>` : ''}
            </div></div>
        </div>
        <span class="grow"></span>
        <div class="wallet-chip"><span style="text-align:right">
          <span class="wallet-chip__amt">${fmtCredits(state.wallet?.balance ?? 0)}</span>
          <span class="wallet-chip__cur">${t('wallet.balance')}</span></span></div>
      </header>
      <div class="tabs" role="tablist" aria-label="${t('account.tabs')}">
        ${TABS.map((x) => html`<button class="tab" type="button" role="tab" data-tab="${x.key}" aria-selected="${String(x.key === current)}">
          ${icon(x.icon, 15)}<span data-i18n="${x.labelKey}">${t(x.labelKey)}</span></button>`)}
      </div>
      <div id="account-panel" role="tabpanel"></div>
    </div>`);
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => navigate(`/account/${b.dataset.tab}`, { scroll: false })));
  const panel = root.querySelector('#account-panel');
  const fn = TABS.find((x) => x.key === current)?.key;
  const cleanup = await ({
    profile, wallet, history, favorites, notifications, responsible, support, settings,
  }[fn] || profile)(panel, ctx);
  return typeof cleanup === 'function' ? cleanup : () => {};
}

// ---------------------------------------------------------------------------
const TAB = (title, sub, body) => html`
  <section class="panel">
    <div class="panel__head"><h2 style="font-size:1.04rem">${title}</h2>${sub ? html`<span class="grow"></span><span class="section__sub">${sub}</span>` : ''}</div>
    <div class="panel__body">${body}</div>
  </section>`;

async function profile(host, ctx) {
  const summary = await api.get('/account/summary').catch(() => null);
  const u = state.user || {};
  const g = summary?.games || {};
  paint(host, html`
    <div class="stack">
      ${kpiGrid([
    { value: fmtCredits(summary?.wallet?.balance ?? 0), labelKey: 'wallet.balance' },
    { value: fmtCredits(summary?.wallet?.lifetimeWagered ?? 0), labelKey: 'profile.wagered' },
    { value: fmtCredits(Math.max(0, summary?.wallet?.lifetimeWon ?? 0)), labelKey: 'profile.won' },
    { value: fmtNum(g.bets ?? 0), labelKey: 'profile.bets' },
    { value: html`<span style="color:${(summary?.wallet?.netResult ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtCredits(summary?.wallet?.netResult ?? 0)}</span>`, labelKey: 'profile.net' },
  ])}
      <div class="grid-2">
        ${TAB(t('profile.title'), t('profile.sub'), html`<div data-role=profile-form></div>`)}
        ${TAB(t('profile.avatar'), '', html`
          <div class="avatar-pick" role="group" aria-label="${t('profile.avatar')}">
            ${AVATARS.map((a) => html`<button type="button" data-avatar="${a}" aria-pressed="${String(a === u.avatar)}" aria-label="${t(`avatar.${a}`)}">${AVATAR_GLYPH[a]}</button>`)}
          </div>
          <p class="section__sub" style="margin-top:10px">${t('profile.avatar_note')}</p>`)}
      </div>
      <div class="grid-2">
        ${TAB(t('profile.activity'), '', html`
          <div class="list-divided">
            ${(summary?.recentTransactions || []).length ? summary.recentTransactions.slice(0, 6).map((tx) => html`
              <div class="row" style="gap:8px"><span class="chip chip--soft">${t(`wallet.kind.${tx.kind}`)}</span>
                <span class="grow section__sub" style="font-size:.8rem">${fmtDateTime(tx.createdAt)}</span>
                <b class="mono" style="color:${tx.amount >= 0 ? 'var(--green)' : 'var(--red)'}">${tx.amount >= 0 ? '+' : '−'}${fmtCredits(Math.abs(tx.amount))}</b></div>`)
              : html`<p class="section__sub">${t('empty.transactions')}</p>`}
          </div>`)}
        ${TAB(t('profile.account'), '', html`
          <dl class="kv">
            <dt>${t('field.email')}</dt><dd>${u.email}</dd>
            <dt>${t('profile.verified')}</dt><dd>${u.emailVerified ? t('btn.yes') : t('btn.no')}</dd>
            <dt>${t('profile.joined')}</dt><dd>${fmtDateTime(u.createdAt)}</dd>
            <dt>${t('profile.last_login')}</dt><dd>${u.lastLoginAt ? fmtRelative(u.lastLoginAt) : '—'}</dd>
            <dt>${t('profile.language')}</dt><dd>${t(`lang.${u.locale || 'en'}`)}</dd>
            <dt>${t('profile.country')}</dt><dd>${u.country || '—'}</dd>
          </dl>`)}
      </div>
      ${g.bets ? html`
        <div class="grid-2">
          ${TAB(t('profile.best'), '', html`<div class="row row--wrap">
            <span class="chip chip--gold">${t('profile.best_mult')} ${fmtMultiplier(g.bestMultiplier || 0)}</span>
            <span class="chip chip--soft">${t('profile.win_rate')} ${fmtPercent(Math.round((g.wins / Math.max(1, g.bets)) * 10000))}</span>
            <span class="chip chip--soft">${t('profile.bets')} ${fmtNum(g.bets)}</span></div>`)}
          ${TAB(t('profile.session'), '', html`<p class="section__sub">${t('profile.session_body', { started: fmtRelative(state.session.startedAt) })}</p>`)}
        </div>` : ''}
    </div>`);
  const form = buildForm(host.querySelector('[data-role=profile-form]'), {
    submitKey: 'btn.save',
    variant: 'gold',
    fields: [
      { name: 'username', labelKey: 'field.username', type: 'username', required: true, autocomplete: 'username' },
      { name: 'email', labelKey: 'field.email', type: 'email', required: true, autocomplete: 'email' },
      { name: 'phone', labelKey: 'field.phone', required: false },
      { name: 'country', labelKey: 'field.country', required: false },
      { name: 'birthdate', labelKey: 'field.birthdate', type: 'date', required: false, hintKey: 'field.birthdate_hint' },
    ],
    values: { username: u.username, email: u.email, phone: u.phone || '', country: u.country || '', birthdate: u.birthdate || '' },
    onSubmit: async (data) => {
      const r = await api.patch('/account/profile', data);
      patch({ user: r.user }, 'session');
      toastOk(t('profile.saved'));
      await refreshSession();
    },
  });
  host.querySelectorAll('[data-avatar]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api.patch('/account/profile', { avatar: b.dataset.avatar });
      patch({ user: r.user }, 'session');
      host.querySelectorAll('[data-avatar]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      toastOk(t('profile.avatar_saved'));
      window.App?.render();
    } catch (err) { toastError(err); }
  }));
  return () => {};
}

async function wallet(host, ctx) {
  const data = await api.get('/wallet?limit=40');
  const w = data;
  let kindFilter = ctx.query.kind || '';
  const paintBody = () => {
    const listHost = host.querySelector('[data-role=tx]');
    api.get(`/wallet?limit=40${kindFilter ? `&kind=${kindFilter}` : ''}`).then((r) => {
      paint(listHost, html`
        <div class="section__head" style="margin:0">
          <div class="row row--wrap filters" style="gap:6px">
            <button class="btn-tab" type="button" data-kind="" aria-selected="${String(!kindFilter)}">${t('wallet.all_kinds')}</button>
            ${['bet', 'payout', 'refund', 'bonus', 'daily_reset', 'admin_credit'].map((k) => html`
              <button class="btn-tab" type="button" data-kind="${k}" aria-selected="${String(kindFilter === k)}">${t(`wallet.kind.${k}`)}</button>`)}
          </div>
          <span class="grow"></span>
          <span class="section__sub">${t('wallet.tx_count', { count: fmtNum(r.transactionCount) })}</span>
        </div>
        ${r.transactions.length ? dataTable({
        columns: [
          { labelKey: 'wallet.date', key: 'createdAt', type: 'date' },
          { labelKey: 'wallet.kind.label', get: (x) => html`<span class="chip chip--soft">${t(`wallet.kind.${x.kind}`)}</span>` },
          { labelKey: 'wallet.note.label', get: (x) => x.noteKey ? t(x.noteKey, x.params || {}) : '' },
          { labelKey: 'wallet.reference', key: 'reference' },
          { labelKey: 'wallet.amount', key: 'amount', type: 'money', num: true },
          { labelKey: 'wallet.balance_after', key: 'balanceAfter', type: 'money', num: true },
        ],
        rows: r.transactions.map((x) => ({ ...x, amount: Math.abs(x.amount) })),
      }) : emptyState({ titleKey: 'empty.transactions' })}`);
      listHost.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { kindFilter = b.dataset.kind; paintBody(); }));
    });
  };
  paint(host, html`
    <div class="stack">
      <div class="notice notice--gold">${icon('info', 18)}<div>${t('rg.demo_notice')}</div></div>
      <div class="grid-2">
        ${TAB(t('wallet.title'), t('wallet.sub'), html`
          <div class="center stack" style="gap:16px">
            <div>
              <div class="stat__v" style="font-size:2.4rem">${fmtCredits(w.balance)}</div>
              <div class="stat__k">${t('wallet.balance')} · ${t('app.demo_badge')}</div>
            </div>
            <div class="row row--wrap" style="justify-content:center">
              ${w.dailyBonus?.available ? html`<button class="btn btn--gold" type="button" data-claim>${t('wallet.daily_claim')} (+${fmtCredits(w.dailyBonus.amount)})</button>`
        : html`<span class="chip chip--soft">${t(`wallet.daily_${w.dailyBonus?.reason || 'disabled'}`)}</span>`}
              <button class="btn" type="button" data-reset>${t('wallet.request_reset')}</button>
              <button class="btn btn--ghost" type="button" data-export>${t('btn.export_csv')}</button>
            </div>
            <dl class="kv" style="width:min(420px,100%)">
              <dt>${t('wallet.lifetime_wagered')}</dt><dd>${fmtCredits(w.lifetimeWagered)}</dd>
              <dt>${t('wallet.lifetime_won')}</dt><dd>${fmtCredits(w.lifetimeWon)}</dd>
              <dt>${t('wallet.net')}</dt><dd style="color:${w.netResult >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtCredits(w.netResult)}</dd>
              <dt>${t('wallet.today_loss')}</dt><dd>${fmtCredits(Math.max(0, w.todayLoss?.loss ?? 0))}</dd>
            </dl>
          </div>`)}
        ${TAB(t('wallet.limits'), '', html`
          <dl class="kv">
            <dt>${t('rg.daily_loss')}</dt><dd>${w.limits?.dailyLoss ? fmtCredits(w.limits.dailyLoss) : t('rg.not_set')}</dd>
            <dt>${t('rg.weekly_wager')}</dt><dd>${w.limits?.weeklyWager ? fmtCredits(w.limits.weeklyWager) : t('rg.not_set')}</dd>
            <dt>${t('rg.session_limit')}</dt><dd>${w.limits?.sessionMinutes ? `${fmtNum(w.limits.sessionMinutes)} ${t('unit.min')}` : t('rg.not_set')}</dd>
          </dl>
          <div class="row" style="margin-top:10px"><a class="btn btn--sm" href="/responsible" data-link>${t('rg.manage')}</a></div>
          <hr />
          <div class="stack" style="gap:6px">
            <strong style="font-size:.9rem">${t('wallet.recent')}</strong>
            ${(w.transactions || []).slice(0, 4).map((tx) => html`
              <div class="row" style="gap:8px"><span class="chip chip--soft">${t(`wallet.kind.${tx.kind}`)}</span>
                <span class="grow section__sub" style="font-size:.78rem">${fmtRelative(tx.createdAt)}</span>
                <b class="mono" style="color:${tx.amount >= 0 ? 'var(--green)' : 'var(--red)'}">${tx.amount >= 0 ? '+' : '−'}${fmtCredits(Math.abs(tx.amount))}</b></div>`)}
          </div>`)}
      </div>
      <div data-role="tx"></div>
    </div>`);
  paintBody();
  host.querySelector('[data-claim]')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try { const r = await api.post('/wallet/claim-daily'); await refreshWallet(); toastOk(t('wallet.daily_done', { amount: fmtCredits(r.amount) })); paint(host, ''); await wallet(host, ctx); }
    catch (err) { ev.currentTarget.disabled = false; toastError(err); }
  });
  host.querySelector('[data-reset]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: t('wallet.request_reset'), message: t('wallet.request_reset_body'), confirmKey: 'btn.request' });
    if (!ok) return;
    try {
      await api.post('/tickets', { category: 'limits', subject: t('wallet.reset_subject'), body: t('wallet.reset_body') });
      toastOk(t('wallet.reset_requested'));
    } catch (err) { toastError(err); }
  });
  host.querySelector('[data-export]')?.addEventListener('click', async () => {
    try {
      const blob = await api.file('/account/export/transactions');
      downloadBlob(blob, 'arenaplay-transactions.csv');
      toastOk(t('export.done'));
    } catch (err) { toastError(err); }
  });
  return () => {};
}

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

async function history(host, ctx) {
  const filters = { gameKey: ctx.query.game || '', status: ctx.query.status || '', kind: ctx.query.kind || '', offset: 0 };
  const limit = 25;
  const load = async () => {
    const params = new URLSearchParams({ limit, offset: String(filters.offset) });
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
    const r = await api.get(`/bets?${params}`);
    const stats = r.stats || {};
    paint(host, html`
      <div class="stack">
        ${kpiGrid([
      { value: fmtNum(stats.bets ?? 0), labelKey: 'profile.bets' },
      { value: fmtCredits(stats.wagered ?? 0), labelKey: 'profile.wagered' },
      { value: fmtCredits(stats.paid ?? 0), labelKey: 'profile.won' },
      { value: fmtCredits(stats.net ?? 0), labelKey: 'profile.net', tone: (stats.net ?? 0) >= 0 ? 'green' : 'red' },
      { value: fmtMultiplier(stats.bestMultiplier ?? 0), labelKey: 'profile.best_mult' },
      { value: `${fmtNum(stats.wins ?? 0)}`, labelKey: 'profile.wins' },
    ])}
        ${TAB(t('history.title'), `${t('history.sub')}`, html`
          <div class="row row--wrap filters" style="margin-bottom:10px">
            <select class="select" data-f-game style="max-width:200px">
              <option value="">${t('history.all_games')}</option>
              ${(r.games || []).map((g) => html`<option value="${g.key}" ${g.key === filters.gameKey ? 'selected' : ''}>${g.nameKey ? t(g.nameKey) : g.name}</option>`)}
            </select>
            <select class="select" data-f-status style="max-width:170px">
              <option value="">${t('history.all_status')}</option>
              ${['won', 'lost', 'pending', 'cashout', 'void'].map((s) => html`<option value="${s}" ${s === filters.status ? 'selected' : ''}>${t(`bet.status.${s}`)}</option>`)}
            </select>
            <select class="select" data-f-kind style="max-width:170px">
              <option value="">${t('history.all_kinds')}</option>
              ${['casino', 'live', 'sports'].map((s) => html`<option value="${s}" ${s === filters.kind ? 'selected' : ''}>${t(`bet.kind.${s}`)}</option>`)}
            </select>
            <span class="grow"></span>
            <button class="btn btn--sm" type="button" data-export>${t('btn.export_csv')}</button>
          </div>
          ${r.rows.length ? html`
            <div class="table-wrap"><table class="data">
              <thead><tr>
                <th scope="col">${t('history.game')}</th><th scope="col">${t('history.selection')}</th>
                <th class="num" scope="col">${t('bet.stake')}</th><th class="num" scope="col">${t('history.payout')}</th>
                <th class="num" scope="col">${t('bet.multiplier')}</th><th scope="col">${t('history.status')}</th>
                <th scope="col">${t('history.date')}</th><th scope="col"></th>
              </tr></thead>
              <tbody>${r.rows.map((b) => html`
                <tr>
                  <td><a href="/game/${b.gameKey}" data-link>${b.gameName || (b.gameKey ? t(`game.${b.gameKey}`, { defaultValue: b.gameKey }) : t(`bet.kind.${b.kind}`))}</a></td>
                  <td class="mono" style="font-size:.78rem">${describeBet(b)}</td>
                  <td class="num">${fmtCredits(b.stake)}</td>
                  <td class="num">${fmtCredits(b.payout)}</td>
                  <td class="num">${b.multiplier ? fmtMultiplier(b.multiplier) : '—'}</td>
                  <td><span class="badge badge--${b.status}">${t(`bet.status.${b.status}`)}</span></td>
                  <td>${fmtRelative(b.settledAt || b.createdAt)}</td>
                  <td class="row" style="gap:4px">
                    <button class="btn btn--sm btn--ghost" type="button" data-verify="${b.id}" aria-label="${t('fairness.verify')}">${icon('shield', 13)}</button>
                    ${b.status === 'pending' ? html`<button class="btn btn--sm" type="button" data-open="${b.gameKey}">${t('btn.open')}</button>` : ''}
                  </td>
                </tr>`)}</tbody>
            </table></div>
            <div class="row row--between" style="margin-top:10px">
              <span class="section__sub">${t('history.showing', { from: fmtNum(filters.offset + 1), to: fmtNum(filters.offset + r.rows.length), total: fmtNum(r.total) })}</span>
              <div class="row" style="gap:6px">
                <button class="btn btn--sm" type="button" data-prev ${filters.offset ? '' : 'disabled'}>${t('btn.prev')}</button>
                <button class="btn btn--sm" type="button" data-next ${filters.offset + limit < r.total ? '' : 'disabled'}>${t('btn.next')}</button>
              </div>
            </div>`
          : emptyState({ icon: 'clock', titleKey: 'empty.history', bodyKey: 'empty.history_body', action: html`<a class="btn btn--gold" href="/casino" data-link>${t('btn.play_now')}</a>` })}`)}
      </div>`);
    host.querySelector('[data-prev]')?.addEventListener('click', () => { filters.offset = Math.max(0, filters.offset - limit); load(); });
    host.querySelector('[data-next]')?.addEventListener('click', () => { filters.offset += limit; load(); });
    for (const [sel, key] of [['[data-f-game]', 'gameKey'], ['[data-f-status]', 'status'], ['[data-f-kind]', 'kind']]) {
      host.querySelector(sel)?.addEventListener('change', (ev) => { filters[key] = ev.target.value; filters.offset = 0; load(); });
    }
    host.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => import('../game/session.js').then((m) => m.openVerifier(b.dataset.verify))));
    host.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => navigate(`/game/${b.dataset.open}`)));
    host.querySelector('[data-export]')?.addEventListener('click', async () => {
      try { downloadBlob(await api.file('/account/export/bets'), 'arenaplay-history.csv'); toastOk(t('export.done')); } catch (err) { toastError(err); }
    });
  };
  await load();
  return () => {};
}

function describeBet(b) {
  const sel = b.selection || {};
  if (sel.legs) return sel.legs.map((l) => l.label || l.side || l.type).join(' + ');
  if (sel.bets) return sel.bets.map((l) => l.side || l.type || describeLegShort(l)).join(' + ');
  if (sel.mines) return t('mines.count') + ' ' + fmtNum(sel.mines);
  if (sel.target) return `${t('dice.target')} ${fmtNum(sel.target)} ${sel.mode ? t(`dice.${sel.mode}`) : ''}`;
  if (sel.autoCashout) return `${t('crash.auto_cashout')} ${fmtMultiplier(sel.autoCashout)}`;
  if (sel.risk) return t(`plinko.${sel.risk}`);
  return '—';
}
const describeLegShort = (l) => (l.numbers?.length ? `${l.type} ${l.numbers.join(',')}` : l.type);

async function favorites(host, ctx) {
  const r = await api.get('/games?category=favorites&limit=60').catch(() => ({ rows: [] }));
  if (!r.rows.length) {
    paint(host, TAB(t('favorites.title'), '', emptyState({ icon: 'star', titleKey: 'favorites.empty', bodyKey: 'favorites.empty_body', action: html`<a class="btn btn--gold" href="/casino" data-link>${t('btn.browse')}</a>` })));
    return () => {};
  }
  paint(host, TAB(t('favorites.title'), t('favorites.sub'), gameGrid(r.rows, { favorite: true })));
  on(host, 'click', '[data-fav]', async (ev, btn) => {
    ev.preventDefault();
    const key = btn.dataset.fav;
    try { await api.post(`/favorites/${key}`, { on: false }); await refreshFavorites(); toastOk(t('lobby.fav_removed')); await favorites(host, ctx); }
    catch (err) { toastError(err); }
  });
  return () => {};
}

async function notifications(host, ctx) {
  const load = async () => {
    const r = await api.get('/notifications?limit=60');
    const rows = r.rows || [];
    paint(host, TAB(t('notifications.title'), `${t('notifications.unread', { count: fmtNum(r.unread) })}`, html`
      <div class="row row--wrap" style="margin-bottom:10px">
        <button class="btn btn--sm" type="button" data-read-all ${r.unread ? '' : 'disabled'}>${t('btn.mark_read')}</button>
        <button class="btn btn--sm btn--ghost" type="button" data-clear>${t('btn.clear_all')}</button>
        <span class="grow"></span>
        <a class="btn btn--sm" href="/settings" data-link>${t('notif.settings')}</a>
      </div>
      ${rows.length ? html`<div class="list-divided">
        ${rows.map((n) => html`
          <div class="row" style="gap:10px;align-items:flex-start;${!n.readAt ? 'opacity:1' : 'opacity:.72'}">
            <span class="toast__icon" style="background:${n.level === 'error' ? 'rgba(242,85,95,.2)' : n.level === 'success' ? 'rgba(34,201,141,.2)' : 'var(--panel-3)'}">
              ${icon(ICONS_BY_LEVEL[n.icon] || n.level || 'info', 14)}</span>
            <div class="grow">
              <strong style="font-size:.92rem">${n.titleKey ? t(n.titleKey, n.params || {}) : ''}</strong>
              <div class="section__sub" style="font-size:.82rem">${n.bodyKey ? t(n.bodyKey, n.params || {}) : ''}</div>
              <div class="section__sub" style="font-size:.72rem">${fmtRelative(n.createdAt)}</div>
            </div>
            ${n.link ? html`<a class="btn btn--sm" href="${n.link}" data-link>${t('btn.open')}</a>` : ''}
            ${!n.readAt ? html`<button class="btn btn--sm btn--ghost" type="button" data-read="${n.id}" aria-label="${t('btn.mark_read')}">${icon('check', 13)}</button>` : ''}
          </div>`)}
      </div>` : emptyState({ icon: 'bell', titleKey: 'empty.notifications', bodyKey: 'empty.notifications_body' })}`));
    host.querySelectorAll('[data-read]').forEach((b) => b.addEventListener('click', async () => {
      await api.post('/notifications/read', { id: Number(b.dataset.read) }); await refreshNotifications(); load();
    }));
    host.querySelector('[data-read-all]')?.addEventListener('click', async () => { await api.post('/notifications/read', { id: 'all' }); await refreshNotifications(); toastOk(t('notif.all_read')); load(); });
    host.querySelector('[data-clear]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: t('btn.clear_all'), message: t('notif.clear_confirm'), confirmKey: 'btn.clear_all', danger: true }))) return;
      await api.del('/notifications'); await refreshNotifications(); toastOk(t('notif.cleared')); load();
    });
  };
  await load();
  return () => {};
}
const ICONS_BY_LEVEL = { trophy: 'trophy', gift: 'gift', chat: 'chat', ticket: 'ticket', wallet: 'wallet', shield: 'shield', info: 'info', warn: 'warn', success: 'check', error: 'warn' };

async function responsible(host, ctx) {
  const s = await api.get('/rg/status');
  const u = state.user || {};
  const paint_ = () => {
    const usage = s.usage || {};
    const l = s.limits || {};
    paint(host, html`
      <div class="stack">
        <div class="notice notice--gold">${icon('info', 18)}<div>${t('rg.demo_notice')}</div></div>
        ${s.selfExclusionUntil ? html`<div class="notice notice--warn">${icon('warn', 18)}
          <div><strong>${t('rg.excluded')}</strong> ${t('rg.excluded_until', { date: fmtDateTime(s.selfExclusionUntil) })}</div></div>` : ''}
        <div class="grid-2">
          ${TAB(t('rg.limits'), t('rg.limits_sub'), html`
            <div data-role=limits-form></div>`)}
          ${TAB(t('rg.usage'), t('rg.usage_sub'), html`
            <div class="stack">
              ${meter(t('rg.daily_loss'), usage.todayNetLoss, l.dailyLoss)}
              ${meter(t('rg.weekly_wager'), usage.weekWagered, l.weeklyWager)}
              ${meter(t('rg.session_time'), usage.sessionMinutes, l.sessionMinutes, t('unit.min'))}
              <dl class="kv">
                <dt>${t('rg.reality_check')}</dt><dd>${l.realityCheckEveryMin ? `${fmtNum(l.realityCheckEveryMin)} ${t('unit.min')}` : t('rg.off')}</dd>
                <dt>${t('rg.today_loss_left')}</dt><dd>${usage.todayLossRemaining !== null && usage.todayLossRemaining !== undefined ? fmtCredits(usage.todayLossRemaining) : t('rg.not_set')}</dd>
                <dt>${t('rg.week_left')}</dt><dd>${usage.weekRemaining !== null && usage.weekRemaining !== undefined ? fmtCredits(usage.weekRemaining) : t('rg.not_set')}</dd>
              </dl>
            </div>`)}
        </div>
        <div class="grid-2">
          ${TAB(t('rg.break'), t('rg.break_sub'), html`
            <div class="row row--wrap">
              ${[0.25, 1, 24, 168, 720].map((h) => html`<button class="btn btn--sm" type="button" data-break="${h}">${h < 1 ? `${fmtNum(h * 60)} ${t('unit.min')}` : h <= 24 ? `${fmtNum(h)} ${t('unit.hour')}` : `${fmtNum(h / 24)} ${t('unit.day')}`}</button>`)}
            </div>
            <p class="section__sub" style="margin-top:8px">${t('rg.break_note')}</p>
            ${s.selfExclusionUntil ? html`<button class="btn btn--red" type="button" data-break="0">${t('rg.remove_exclusion')}</button>` : ''}`)}
          ${TAB(t('rg.check'), '', html`
            <div class="stack" data-role=quiz></div>`)}
        </div>
        ${demoNotice('rg.help_note')}
      </div>`);
    buildForm(host.querySelector('[data-role=limits-form]'), {
      submitKey: 'btn.save_limits',
      layout: '',
      fields: [
        { name: 'dailyLoss', labelKey: 'rg.daily_loss', type: 'cents', min: 0, hintKey: 'rg.daily_loss_hint', suffixKey: '৳' },
        { name: 'weeklyWager', labelKey: 'rg.weekly_wager', type: 'cents', min: 0, suffixKey: '৳' },
        { name: 'sessionMinutes', labelKey: 'rg.session_limit', type: 'number', min: 0, max: 1440, suffixKey: 'unit.min' },
        { name: 'realityCheck', labelKey: 'rg.reality_toggle', type: 'checkbox' },
      ],
      values: {
        dailyLoss: l.dailyLoss ? l.dailyLoss / 100 : '',
        weeklyWager: l.weeklyWager ? l.weeklyWager / 100 : '',
        sessionMinutes: l.sessionMinutes ?? '',
        realityCheck: !!s.realityCheck,
      },
      onSubmit: async (data) => {
        const body = {
          dailyLossLimit: data.dailyLoss ? Math.round(data.dailyLoss * 100) : null,
          weeklyWagerLimit: data.weeklyWager ? Math.round(data.weeklyWager * 100) : null,
          sessionLimitMin: data.sessionMinutes ? Number(data.sessionMinutes) : null,
          realityCheck: !!data.realityCheck,
        };
        await api.post('/rg/limits', body);
        await refreshSession();
        s.limits = { ...l, ...body };
        toastOk(t('rg.limits_saved'));
        paint_();
      },
    });
    host.querySelectorAll('[data-break]').forEach((b) => b.addEventListener('click', async () => {
      const hours = Number(b.dataset.break);
      const ok = await confirmDialog({
        title: hours ? t('rg.break_start') : t('rg.remove_exclusion'),
        message: hours ? t('rg.break_confirm', { hours: fmtNum(hours) }) : t('rg.remove_confirm'),
        confirmKey: 'btn.confirm',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.post('/rg/self-exclude', { hours });
        await refreshSession();
        toastOk(t(hours ? 'rg.break_started' : 'rg.exclusion_removed'));
        await refreshSession();
        await render(host, ctx);
      } catch (err) { toastError(err); }
    }));
    renderQuiz(host.querySelector('[data-role=quiz]'));
  };
  paint_();
  return () => {};
}

const meter = (label, used, limit, unit = '৳') => {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return html`
    <div class="stack" style="gap:4px">
      <div class="row row--between"><span style="font-size:.84rem;font-weight:700">${label}</span>
        <span class="mono section__sub">${limit ? `${fmtNum(used / (unit === '৳' ? 100 : 1))} / ${fmtNum(limit / (unit === '৳' ? 100 : 1))}${unit === '৳' ? '' : ''}` : t('rg.not_set')}</span></div>
      <div class="meter"><span style="width:${pct}%;${pct > 80 ? 'background:linear-gradient(90deg,#f2555f,#ff9aa2)' : ''}"></span></div>
    </div>`;
};

const QUIZ = [
  'rg.q1', 'rg.q2', 'rg.q3', 'rg.q4', 'rg.q5',
];
function renderQuiz(host) {
  const answers = JSON.parse(localStorage.getItem('arenaplay.rg_quiz') || '[]');
  const paint_ = () => {
    const score = answers.filter((a) => a).length;
    paint(host, html`
      <p class="section__sub">${t('rg.check_sub')}</p>
      ${QUIZ.map((q, i) => html`
        <div class="row row--between" style="gap:8px">
          <span style="font-size:.86rem">${t(q)}</span>
          <div class="row" style="gap:4px">
            <button class="btn-tab" type="button" data-quiz="${i}" data-v="0" aria-selected="${String(answers[i] === false)}">${t('btn.no')}</button>
            <button class="btn-tab" type="button" data-quiz="${i}" data-v="1" aria-selected="${String(answers[i] === true)}">${t('btn.yes')}</button>
          </div>
        </div>`)}
      <div class="notice ${score >= 3 ? 'notice--warn' : 'notice--info'}">${icon(score >= 3 ? 'warn' : 'check', 18)}
        <div>${t(score >= 3 ? 'rg.check_risk' : 'rg.check_ok', { count: fmtNum(score) })}</div></div>
      ${score >= 3 ? html`<div class="row row--wrap"><button class="btn btn--red btn--sm" type="button" data-act="cool">${t('rg.cool_off')}</button>
        <a class="btn btn--sm" href="/legal/gambling-help" data-link>${t('rg.find_help')}</a></div>` : ''}`);
    host.querySelectorAll('[data-quiz]').forEach((b) => b.addEventListener('click', () => {
      answers[Number(b.dataset.quiz)] = b.dataset.v === '1';
      localStorage.setItem('arenaplay.rg_quiz', JSON.stringify(answers));
      paint_();
    }));
    host.querySelector('[data-act=cool]')?.addEventListener('click', () => host.closest('.panel')?.parentElement?.querySelector('[data-break="0.25"]')?.click());
  };
  paint_();
}

async function support(host, ctx) {
  const content = state.content || {};
  const r = await api.get('/tickets').catch(() => ({ rows: [] }));
  paint(host, html`
    <div class="stack">
      <div class="grid-2">
        ${TAB(t('support.new'), t('support.new_sub'), html`<div data-role=ticket-form></div>`)}
        ${TAB(t('support.channels'), '', html`
          <dl class="kv">
            <dt>${t('support.email')}</dt><dd>${content.support?.email || 'support@arenaplay.local'}</dd>
            <dt>${t('support.hours')}</dt><dd>${t('support.hours_value')}</dd>
            <dt>${t('support.response')}</dt><dd>${t('support.response_value')}</dd>
          </dl>
          <hr />
          <div class="stack" style="gap:8px">
            <strong style="font-size:.9rem">${t('support.faq')}</strong>
            ${['support.faq_1', 'support.faq_2', 'support.faq_3'].map((k) => html`
              <details><summary style="cursor:pointer;font-weight:700;font-size:.88rem">${t(`${k}_q`)}</summary>
                <p class="section__sub">${t(k)}</p></details>`)}
          </div>
          <hr />
          <a class="btn btn--sm" href="/legal/gambling-help" data-link>${t('rg.find_help')}</a>`)}
      </div>
      ${TAB(t('support.mine'), '', (r.rows || []).length ? html`
        <div class="list-divided">
          ${r.rows.map((tk) => html`
            <div class="row" style="gap:8px">
              <span class="badge badge--${tk.status === 'open' ? 'pending' : tk.status === 'closed' ? 'void' : 'won'}">${t(`ticket.status.${tk.status}`)}</span>
              <div class="grow"><strong style="font-size:.9rem">${tk.subject}</strong>
                <div class="section__sub" style="font-size:.76rem">${tk.ref} · ${t(`ticket.cat.${tk.category}`)} · ${fmtRelative(tk.createdAt)}</div></div>
              <button class="btn btn--sm" type="button" data-ticket="${tk.ref}">${t('btn.open')}</button>
            </div>`)}
        </div>` : emptyState({ icon: 'chat', titleKey: 'empty.tickets', bodyKey: 'empty.tickets_body' }))}
    </div>`);
  buildForm(host.querySelector('[data-role=ticket-form]'), {
    submitKey: 'support.send',
    layout: 'form-grid',
    fields: [
      { name: 'category', labelKey: 'ticket.category', type: 'select', required: true, wide: true, options: ['general', 'account', 'technical', 'limits', 'responsible_gaming', 'other'].map((k) => ({ value: k, labelKey: `ticket.cat.${k}` })) },
      { name: 'subject', labelKey: 'ticket.subject', required: true, min: 4, maxLen: 120, wide: true },
      { name: 'body', labelKey: 'ticket.message', type: 'textarea', required: true, min: 12, wide: true, placeholderKey: 'ticket.message_ph' },
    ],
    onSubmit: async (data) => {
      const out = await api.post('/tickets', data);
      toastOk(t('support.created', { ref: out.ref }));
      await refreshNotifications();
      await render(host, ctx);
    },
  });
  on(host, 'click', '[data-ticket]', (ev, b) => openTicket(b.dataset.ticket, () => render(host, ctx)));
  return () => {};
}

async function openTicket(ref, after) {
  try {
    const t2 = await api.get(`/tickets/${ref}`);
    const body = document.createElement('div');
    paint(body, html`
      <div class="stack">
        <div class="row row--wrap"><span class="badge badge--${t2.ticket.status === 'closed' ? 'void' : 'pending'}">${t(`ticket.status.${t2.ticket.status}`)}</span>
          <span class="chip chip--soft">${t(`ticket.cat.${t2.ticket.category}`)}</span>
          <span class="grow"></span><span class="section__sub mono">${t2.ticket.ref}</span></div>
        <h3 style="margin:0">${t2.ticket.subject}</h3>
        <div class="list-divided" data-role=msgs>
          ${t2.messages.map((m) => html`
            <div class="row" style="gap:8px;align-items:flex-start">
              <span class="avatar avatar--sm">${(m.fromAdmin ? 'A' : (m.author || 'Y')[0]).toUpperCase()}</span>
              <div class="grow"><strong style="font-size:.8rem">${m.fromAdmin ? t('ticket.staff') : t('ticket.you')}</strong>
                <div style="font-size:.88rem">${m.body}</div>
                <div class="section__sub" style="font-size:.72rem">${fmtDateTime(m.createdAt)}</div></div>
            </div>`)}
        </div>
        ${t2.ticket.status !== 'closed' ? html`
          <div class="field"><textarea class="textarea" data-role=reply placeholder="${t('ticket.reply_ph')}"></textarea></div>
          <div class="row"><button class="btn btn--gold" type="button" data-reply>${t('ticket.send_reply')}</button>
            <button class="btn btn--ghost" type="button" data-close-ticket>${t('ticket.close')}</button></div>` : html`
          <p class="section__sub">${t('ticket.closed_note')}</p>`}
      </div>`);
    const m = modal({ title: t('support.ticket'), wide: true, body });
    body.querySelector('[data-reply]')?.addEventListener('click', async (ev) => {
      const text = body.querySelector('[data-role=reply]').value.trim();
      ev.currentTarget.disabled = true;
      try { await api.post(`/tickets/${ref}/reply`, { body: text }); m.close(); after?.(); toastOk(t('ticket.replied')); }
      catch (err) { toastError(err); ev.currentTarget.disabled = false; }
    });
    body.querySelector('[data-close-ticket]')?.addEventListener('click', async () => {
      await api.post(`/tickets/${ref}/close`);
      m.close(); after?.(); toastOk(t('ticket.closed'));
    });
  } catch (err) { toastError(err); }
}

async function settings(host, ctx) {
  const u = state.user || {};
  const devHelper = state.boot?.env === 'development';
  paint(host, html`
    <div class="stack">
      <div class="grid-2">
        ${TAB(t('settings.language'), t('settings.language_sub'), html`
          <div class="row row--wrap" role="group" aria-label="${t('settings.language')}">
            ${['en', 'bn'].map((code) => html`
              <button class="btn ${code === locale() ? 'btn--gold' : ''}" type="button" data-lang-pick="${code}">
                <span>${code === 'bn' ? 'বাংলা' : 'English'}</span></button>`)}
          </div>
          <p class="section__sub" style="margin-top:8px">${t('settings.language_note')}</p>
          <div class="row" style="gap:8px;margin-top:6px">
            <span class="chip chip--soft">${t('settings.digits')}: ${isBengali() ? t('settings.digits_bn') : t('settings.digits_en')}</span>
            <span class="chip chip--soft">${t('settings.dates')}: ${isBengali() ? 'bn-BD' : 'en-US'}</span>
          </div>`)}
        ${TAB(t('settings.notifications'), '', html`
          <div class="stack" data-role=notify></div>`)}
        ${TAB(t('settings.password'), t('settings.password_sub'), html`<div data-role=pw-form></div>`)}
        ${TAB(t('settings.security'), '', html`
          <div class="stack" data-role=sessions></div>`)}
      </div>
      ${TAB(t('settings.privacy'), t('settings.privacy_sub'), html`
        <div class="row row--wrap">
          <button class="btn btn--sm" type="button" data-export-profile>${t('settings.export')}</button>
          <a class="btn btn--sm" href="/legal/privacy" data-link>${t('legal.privacy')}</a>
          <span class="grow"></span>
          <button class="btn btn--sm btn--red" type="button" data-close-account>${t('settings.close_account')}</button>
        </div>`)}
    </div>`);

  host.querySelectorAll('[data-lang-pick]').forEach((b) => b.addEventListener('click', async () => {
    await setLocale(b.dataset.langPick);
    toastOk(t('lang.switched', { lang: b.dataset.langPick === 'bn' ? 'বাংলা' : 'English' }));
    await refreshSession();
  }));

  const notifyHost = host.querySelector('[data-role=notify]');
  const flags = { notifyEmail: !!u.notifyEmail, notifyPush: !!u.notifyPush, marketingOptin: !!u.marketingOptin };
  const paintNotify = () => {
    paint(notifyHost, html`
      ${[['notifyEmail', 'settings.notify_email'], ['notifyPush', 'settings.notify_push'], ['marketingOptin', 'settings.notify_marketing']].map(([k, label]) => html`
        <label class="toggle"><input type="checkbox" data-notify="${k}" ${flags[k] ? 'checked' : ''} /><span>${t(label)}</span></label>`)}
      <p class="section__sub">${t('settings.notify_note')}</p>`);
    notifyHost.querySelectorAll('[data-notify]').forEach((c) => c.addEventListener('change', async () => {
      flags[c.dataset.notify] = c.checked;
      try { const r = await api.patch('/account/profile', { [c.dataset.notify]: c.checked }); patch({ user: r.user }, 'session'); toastOk(t('settings.saved')); }
      catch (err) { toastError(err); c.checked = !c.checked; }
    }));
  };
  paintNotify();

  buildForm(host.querySelector('[data-role=pw-form]'), {
    submitKey: 'settings.change_password',
    layout: '',
    fields: [
      { name: 'currentPassword', labelKey: 'field.current_password', type: 'password', required: true, wide: true, autocomplete: 'current-password' },
      { name: 'newPassword', labelKey: 'field.new_password', type: 'password', required: true, wide: true, autocomplete: 'new-password' },
      { name: 'confirm', labelKey: 'field.confirm_password', type: 'password', required: true, wide: true, autocomplete: 'new-password', validate: (v, all) => (v === all.newPassword ? null : 'val.password_mismatch') },
    ],
    onSubmit: async (data) => {
      await api.post('/auth/password', { currentPassword: data.currentPassword, newPassword: data.newPassword });
      toastOk(t('auth.password_updated'));
      await refreshSession();
    },
  });

  const sessHost = host.querySelector('[data-role=sessions]');
  const loadSessions = async () => {
    try {
      const s = await api.get('/account/sessions');
      paint(sessHost, html`
        ${s.rows.length ? html`<div class="list-divided">
          ${s.rows.map((row) => html`
            <div class="row" style="gap:8px"><span class="chip ${row.current ? 'chip--green' : 'chip--soft'}">${row.current ? t('settings.current') : t('settings.other')}</span>
              <div class="grow" style="min-width:0"><div style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${row.userAgent || t('settings.unknown_device')}</div>
                <div class="section__sub" style="font-size:.72rem">${t('settings.last_seen')} ${fmtRelative(row.lastSeenAt || row.createdAt)}</div></div>
              <span class="mono section__sub">${row.id}</span></div>`)}
        </div>` : html`<p class="section__sub">${t('settings.no_sessions')}</p>`}
        <div class="row" style="margin-top:10px"><button class="btn btn--sm btn--red" type="button" data-revoke-all>${t('settings.revoke_all')}</button></div>`);
      sessHost.querySelector('[data-revoke-all]')?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: t('settings.revoke_all'), message: t('settings.revoke_all_body'), confirmKey: 'btn.revoke' }))) return;
        await api.post('/account/sessions/revoke', { all: true }); toastOk(t('settings.revoked')); loadSessions();
      });
    } catch { paint(sessHost, html`<p class="section__sub">${t('err.load_sessions')}</p>`); }
  };
  loadSessions();

  host.querySelector('[data-export-profile]')?.addEventListener('click', async () => {
    try { downloadBlob(await api.file('/account/export/profile'), 'arenaplay-profile.json'); toastOk(t('export.done')); } catch (err) { toastError(err); }
  });
  host.querySelector('[data-close-account]')?.addEventListener('click', async () => {
    const pw = prompt(t('settings.close_prompt'), '');
    if (pw === null) return;
    const ok = await confirmDialog({ title: t('settings.close_account'), message: t('settings.close_body'), confirmKey: 'btn.delete_forever', danger: true });
    if (!ok) return;
    try {
      await api.post('/account/close', { password: pw });
      patch({ user: null, wallet: null }, 'session');
      toastOk(t('settings.closed'));
      navigate('/');
    } catch (err) { toastError(err); }
  });
  return () => {};
}

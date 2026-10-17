/**
 * Admin console. Every control maps to a real, server-enforced endpoint:
 * mutating routes are declared `{ auth: 'admin' }` (or `staff`) in src/api/admin.js,
 * so a moderator sees some controls disabled and the API still rejects the write.
 * Hiding buttons is only an affordance — never the security boundary.
 */
import { html, render as paint, icon } from '../core/dom.js';
import { t, fmtNum, fmtCredits, fmtPercent, fmtDateTime, fmtRelative, fmtDuration } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { toast, toastOk, toastError, modal, confirmDialog } from '../core/ui.js';
import { buildForm } from '../forms.js';
import {
  kpiGrid, dataTable, barChart, statusPill, chip, rowActions, loadingInline, emptyState, pageHeader,
} from '../components/widgets.js';
import { navigate } from '../app.js';

const TABS = [
  { key: 'dashboard', labelKey: 'admin.tab_dashboard', icon: 'chart' },
  { key: 'users', labelKey: 'admin.tab_users', icon: 'users' },
  { key: 'games', labelKey: 'admin.tab_games', icon: 'games' },
  { key: 'live', labelKey: 'admin.tab_live', icon: 'live' },
  { key: 'content', labelKey: 'admin.tab_content', icon: 'bell' },
  { key: 'sports', labelKey: 'admin.tab_sports', icon: 'sports' },
  { key: 'ledger', labelKey: 'admin.tab_ledger', icon: 'wallet' },
  { key: 'tickets', labelKey: 'admin.tab_tickets', icon: 'chat' },
  { key: 'settings', labelKey: 'admin.tab_settings', icon: 'cog', admin: true },
  { key: 'logs', labelKey: 'admin.tab_logs', icon: 'shield', admin: true },
];

const isAdmin = () => state.user?.role === 'admin';
const money = (n) => fmtCredits(Number(n) || 0);
/** Server log timestamps are SQL UTC strings ("YYYY-MM-DD HH:MM:SS") — normalise first. */
const when = (s) => (s ? fmtDateTime(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`) : '—');
const ago = (s) => (s ? fmtRelative(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`) : '—');
const flag = (v) => (v === true || v === '1' || v === 1);

export async function render(root, ctx) {
  const tab = TABS.some((x) => x.key === ctx.tab) ? ctx.tab : 'dashboard';
  const box = document.createElement('div');
  box.className = 'stack';
  const shell = html`
    <div class="stack admin-shell">
      ${pageHeader({
    titleKey: 'admin.title',
    subKey: 'admin.sub',
    actions: html`
      <span class="row row--wrap" style="gap:8px">
        <span class="chip chip--${isAdmin() ? 'gold' : 'soft'}">${icon('shield', 13)} ${t(isAdmin() ? 'admin.role_admin' : 'admin.role_moderator')}</span>
        <button class="btn btn--sm" type="button" data-refresh>${icon('refresh', 14)} ${t('btn.refresh')}</button>
      </span>`,
  })}
      <div class="tabs scroll-x" role="tablist" aria-label="${t('admin.title')}">
        ${TABS.map((x) => html`
          <button class="tab" type="button" role="tab" data-admin-tab="${x.key}" aria-selected="${String(x.key === tab)}">
            ${icon(x.icon, 14)}<span data-i18n="${x.labelKey}">${t(x.labelKey)}</span>
            ${x.admin && !isAdmin() ? icon('lock', 12) : ''}
          </button>`)}
      </div>
      <div data-host></div>
    </div>`;
  paint(root, shell);
  const host = root.querySelector('[data-host]');
  let dead = false;
  const runTab = () => { if (!dead) dispatch(tab, host, ctx); };
  root.querySelector('[data-refresh]').addEventListener('click', runTab);
  root.querySelectorAll('[data-admin-tab]').forEach((b) => b.addEventListener('click', () => navigate(`/admin/${b.dataset.adminTab}`)));
  await dispatch(tab, host, ctx);
  return () => { dead = true; };
}

async function dispatch(tab, host, ctx) {
  paint(host, loadingInline('admin.loading'));
  const fn = TAB_FN[tab] || TAB_FN.dashboard;
  try { await fn(host, ctx); } catch (err) {
    paint(host, html`<div class="panel"><div class="panel__body">${emptyState({ icon: 'warn', titleKey: err?.code || 'admin.tab_failed', bodyKey: 'admin.tab_failed_body' })}</div></div>`);
  }
}

const TAB_FN = {
  // ---------------------------------------------------------------- dashboard
  async dashboard(host, ctx) {
    const days = ctx.filters?.days || 7;
    const data = await api.get(`/admin/overview?days=${days}&series=14`);
    const o = data.overview; const sys = data.system;
    const [games, users] = await Promise.all([
      api.get(`/admin/stats/games?days=${days}`).then((r) => r.rows).catch(() => []),
      api.get(`/admin/stats/users?days=${days}&limit=8`).then((r) => r.rows).catch(() => []),
    ]);
    state.adminOverview = data;
    paint(host, html`
      <div class="stack">
        <div class="row row--wrap" style="gap:6px">
          <span class="section__sub">${t('admin.range')}</span>
          ${[1, 7, 30, 90].map((d) => html`<button class="btn btn--sm${d === Number(days) ? ' btn--gold' : ''}" type="button" data-days="${d}">${t(`admin.range_${d}d`)}</button>`)}
        </div>
        ${kpiGrid([
          { value: fmtNum(o.users.total), labelKey: 'admin.kpi_users', delta: html`<span>${t('admin.kpi_new')}: <strong class="up">${fmtNum(o.users.new)}</strong> · ${t('admin.kpi_active')}: ${fmtNum(o.users.active)}</span>` },
          { value: fmtNum(o.bets.count), labelKey: 'admin.kpi_bets', delta: html`<span>${t('admin.kpi_pending')}: ${fmtNum(o.bets.pending)} · ${t('admin.kpi_winrate')}: ${fmtPercent(o.bets.winRate * 100, 1)}</span>` },
          { value: money(o.money.wagered), labelKey: 'admin.kpi_wagered', delta: html`<span>${t('admin.kpi_paid')}: ${money(o.money.paid)}</span>` },
          { value: money(o.money.ngr), labelKey: 'admin.kpi_ngr', tone: o.money.ngr >= 0 ? 'green' : 'red', delta: html`<span>${t('admin.kpi_rtp')}: ${fmtPercent(o.money.actualRtpBps / 100, 2)} · ${t('admin.kpi_avg_stake')}: ${money(o.money.avgStake)}</span>` },
          { value: `${fmtNum(o.games.enabled)} / ${fmtNum(o.games.total)}`, labelKey: 'admin.kpi_games', delta: html`<span>${t('admin.kpi_live_fixtures')}: ${fmtNum(o.sports.live)} · ${t('admin.kpi_upcoming')}: ${fmtNum(o.sports.scheduled)}</span>` },
          { value: fmtNum(o.tickets.open), labelKey: 'admin.kpi_tickets', tone: o.errors.unresolved ? 'red' : undefined, delta: html`<span>${t('admin.kpi_errors')}: ${fmtNum(o.errors.unresolved)} · ${t('admin.kpi_suspended')}: ${fmtNum(o.users.suspended)}</span>` },
        ])}
        <div class="grid-2">
          <section class="panel">
            <div class="panel__head">${icon('chart', 16)}<h3>${t('admin.series_bets')}</h3></div>
            <div class="panel__body">${barChart(data.series.map((d) => ({ label: d.day, short: d.day.slice(5), value: d.bets })), { labelKey: 'admin.series_bets_sub' })}</div>
          </section>
          <section class="panel">
            <div class="panel__head">${icon('wallet', 16)}<h3>${t('admin.series_ngr')}</h3></div>
            <div class="panel__body">${barChart(data.series.map((d) => ({ label: d.day, short: d.day.slice(5), value: Math.max(0, d.ngr / 100) })), { labelKey: 'admin.series_ngr_sub' })}</div>
          </section>
        </div>
        <div class="grid-2">
          <section class="panel">
            <div class="panel__head">${icon('games', 16)}<h3>${t('admin.top_games')}</h3></div>
            <div class="panel__body">${dataTable({
    columns: [
      { labelKey: 'admin.col_game', get: (r) => html`<div><strong>${r.name}</strong><div class="section__sub mono">${r.engine}</div></div>` },
      { labelKey: 'admin.col_bets', key: 'bets', num: true, type: 'num' },
      { labelKey: 'admin.col_wagered', get: (r) => money(r.wagered), num: true },
      { labelKey: 'admin.col_rtp', get: (r) => fmtPercent(r.actualRtpBps / 100, 1), num: true },
      { labelKey: 'admin.col_enabled', get: (r) => statusPill(r.enabled ? 'active' : 'closed'), num: true },
    ],
    rows: games.slice(0, 8), emptyKey: 'admin.games_empty',
  })}</div>
          </section>
          <section class="panel">
            <div class="panel__head">${icon('users', 16)}<h3>${t('admin.top_users')}</h3></div>
            <div class="panel__body">${dataTable({
    columns: [
      { labelKey: 'admin.col_player', get: (r) => html`<strong>${r.username}</strong>` },
      { labelKey: 'admin.col_bets', key: 'bets', num: true, type: 'num' },
      { labelKey: 'admin.col_wagered', get: (r) => money(r.wagered), num: true },
      { labelKey: 'admin.col_ngr', get: (r) => html`<span class="${r.ngr >= 0 ? 'up' : 'down'}">${money(r.ngr)}</span>`, num: true },
    ],
    rows: users, emptyKey: 'admin.users_empty',
  })}</div>
          </section>
        </div>
        <section class="panel">
          <div class="panel__head">${icon('shield', 16)}<h3>${t('admin.system_title')}</h3>
            <span class="grow"></span>${chip(t('app.demo_badge'), 'gold')}</div>
          <div class="panel__body"><dl class="kv">
            <dt>${t('admin.sys_uptime')}</dt><dd>${fmtDuration(sys.uptimeSeconds)}</dd>
            <dt>${t('admin.sys_runtime')}</dt><dd>${sys.nodeVersion} · ${sys.env}</dd>
            <dt>${t('admin.sys_memory')}</dt><dd>${fmtNum(sys.memoryMb.rss)} MB ${t('admin.sys_rss')} · ${fmtNum(sys.memoryMb.heap)} MB ${t('admin.sys_heap')}</dd>
            <dt>${t('admin.sys_db')}</dt><dd class="mono">${sys.database.file} · ${fmtNum(Math.round(sys.database.sizeBytes / 1024))} KB</dd>
            <dt>${t('admin.sys_migrations')}</dt><dd>${fmtNum(sys.database.migrationsApplied)}</dd>
            <dt>${t('admin.sys_sse')}</dt><dd>${fmtNum(sys.sseClients)}</dd>
            <dt>${t('admin.sys_engines')}</dt><dd>${t('admin.sys_crash')}: ${statusPill(sys.engines.crash.running ? 'live' : 'paused')} ${t('admin.sys_live')}: ${statusPill(sys.engines.live.running ? 'live' : 'paused')}</dd>
            <dt>${t('admin.sys_provider')}</dt><dd>${sys.sportsProvider}</dd>
            <dt>${t('admin.sys_demo_mode')}</dt><dd>${sys.demoMode ? chip(t('btn.yes'), 'ok') : chip(t('btn.no'), 'warn')}</dd>
            <dt>${t('admin.sys_circulation')}</dt><dd>${money(o.wallet?.total_balance)}</dd>
          </dl>
          <div class="row row--wrap">
            <button class="btn btn--sm" type="button" data-maint>${t(sys.maintenance ? 'admin.maint_end' : 'admin.maint_start')}</button>
            <a class="btn btn--sm" href="/admin/settings" data-link>${t('admin.open_settings')}</a>
            <a class="btn btn--sm" href="/admin/logs" data-link>${t('admin.open_logs')}</a>
            <a class="btn btn--sm" href="/admin/content" data-link>${t('admin.publish_announcement')}</a>
          </div></div>
        </section>
      </div>`);
    host.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => navigate('/admin/dashboard', { filters: { days: Number(b.dataset.days) }, replace: true })));
    host.querySelector('[data-maint]')?.addEventListener('click', (ev) => toggleMaintenance(ev.currentTarget));
  },

  // -------------------------------------------------------------------- users
  async users(host, ctx) {
    const f = ctx.filters || {};
    const out = await api.get(`/admin/users?q=${encodeURIComponent(f.q || '')}&role=${f.role || ''}&status=${f.status || ''}&limit=25&offset=${f.offset || 0}`);
    paint(host, html`
      <section class="panel">
        <div class="panel__head">${icon('users', 16)}<h3>${t('admin.users_title')}</h3>
          <span class="grow"></span><span class="section__sub">${t('admin.found', { total: fmtNum(out.total) })}</span></div>
        <div class="panel__body stack">
          <form class="row row--wrap" data-search>
            <input class="input" name="q" placeholder="${t('admin.users_search')}" value="${f.q || ''}" aria-label="${t('admin.users_search')}" />
            <select class="select" name="role" aria-label="${t('admin.col_role')}">
              <option value="">${t('admin.role_any')}</option>
              ${['user', 'moderator', 'admin'].map((r) => html`<option value="${r}"${f.role === r ? ' selected' : ''}>${t(`user.role.${r}`)}</option>`)}
            </select>
            <select class="select" name="status" aria-label="${t('admin.col_status')}">
              <option value="">${t('admin.status_any')}</option>
              ${['active', 'suspended', 'closed'].map((s) => html`<option value="${s}"${f.status === s ? ' selected' : ''}>${t(`user.status.${s}`)}</option>`)}
            </select>
            <button class="btn btn--gold" type="submit">${icon('search', 15)} ${t('btn.search')}</button>
          </form>
          ${dataTable({
    onRow: 'id',
    columns: [
      { labelKey: 'admin.col_id', get: (r) => html`<span class="mono">#${fmtNum(r.id)}</span>` },
      { labelKey: 'admin.col_player', get: (r) => html`<div><strong>${r.username}</strong><div class="section__sub mono">${r.email}</div></div>` },
      { labelKey: 'admin.col_role', get: (r) => chip(t(`user.role.${r.role}`), r.role === 'admin' ? 'gold' : r.role === 'moderator' ? 'blue' : 'soft') },
      { labelKey: 'admin.col_status', get: (r) => statusPill(r.status) },
      { labelKey: 'admin.col_balance', get: (r) => money(r.balance), num: true },
      { labelKey: 'admin.col_wagered', get: (r) => money(r.lifetimeWagered), num: true },
      { labelKey: 'admin.col_bets', get: (r) => fmtNum(r.betsCount), num: true },
      { labelKey: 'admin.col_lang', get: (r) => chip(r.locale === 'bn' ? 'বাংলা' : 'EN', 'soft') },
      { labelKey: 'admin.col_seen', get: (r) => html`<span class="section__sub">${r.lastLoginAt ? ago(r.lastLoginAt) : t('admin.never')}</span>` },
      { labelKey: 'admin.col_actions', get: (r) => rowActions([
        { key: 'view', icon: 'eye', labelKey: 'admin.view_user', id: r.id },
        { key: 'credits', icon: 'wallet', labelKey: 'admin.grant_credits', id: r.id },
        { key: 'notify', icon: 'send', labelKey: 'admin.notify_user', id: r.id },
        { key: 'suspend', icon: 'lock', labelKey: r.status === 'suspended' ? 'admin.activate' : 'admin.suspend', id: r.id },
      ]) },
    ],
    rows: out.rows, emptyKey: 'admin.users_empty',
  })}
          <div class="pager">
            <button class="btn btn--sm" type="button" data-prev${!f.offset ? ' disabled' : ''}>${icon('back', 14)} ${t('btn.prev')}</button>
            <span class="section__sub">${fmtNum((f.offset || 0) + 1)}–${fmtNum((f.offset || 0) + out.rows.length)} / ${fmtNum(out.total)}</span>
            <button class="btn btn--sm" type="button" data-next${out.rows.length < 25 ? ' disabled' : ''}>${t('btn.next')} ${icon('arrow', 14)}</button>
          </div>
        </div>
      </section>`);
    wireTable(host, (id, action) => {
      if (action === 'credits') return grantCreditsDialog(Number(id), () => TAB_FN.users(host, ctx));
      if (action === 'notify') return notifyUserDialog(Number(id));
      if (action === 'suspend') return patchUser(Number(id), { status: out.rows.find((r) => r.id === Number(id))?.status === 'suspended' ? 'active' : 'suspended' }, () => TAB_FN.users(host, ctx));
      return openUser(Number(id), () => TAB_FN.users(host, ctx));
    }, {
      onForm: (fd) => navigate('/admin/users', { filters: { q: fd.get('q'), role: fd.get('role'), status: fd.get('status'), offset: 0 }, replace: true }),
      onPage: (d) => navigate('/admin/users', { filters: { ...f, offset: Math.max(0, (f.offset || 0) + d * 25) }, replace: true }),
    });
  },

  // -------------------------------------------------------------------- games
  async games(host, ctx) {
    const q = String(ctx.filters?.q || '').toLowerCase();
    const out = await api.get('/admin/games');
    const rows = q ? out.rows.filter((r) => `${r.key} ${r.name} ${r.engine} ${r.category}`.toLowerCase().includes(q)) : out.rows;
    paint(host, html`
      <section class="panel">
        <div class="panel__head">${icon('games', 16)}<h3>${t('admin.games_title')}</h3>
          <span class="grow"></span>
          ${isAdmin() ? html`<button class="btn btn--sm btn--gold" type="button" data-new>${icon('plus', 15)} ${t('admin.new_game')}</button>` : chip(t('admin.admin_only'), 'soft')}</div>
        <div class="panel__body stack">
          <p class="section__sub">${t('admin.games_sub')}</p>
          <form class="row row--wrap" data-search>
            <input class="input" name="q" placeholder="${t('admin.games_search')}" value="${ctx.filters?.q || ''}" aria-label="${t('admin.games_search')}" />
            <button class="btn" type="submit">${icon('search', 15)} ${t('btn.filter')}</button>
          </form>
          ${dataTable({
    onRow: 'key',
    columns: [
      { labelKey: 'admin.col_game', get: (r) => html`<div class="row" style="gap:8px"><span class="mono">${fmtNum(r.sort)}</span>
          <div><strong>${r.name}</strong><div class="section__sub mono">${r.key} · ${r.engine}</div></div></div>` },
      { labelKey: 'admin.col_category', get: (r) => chip(t(`cat.${r.category}`), 'soft') },
      { labelKey: 'admin.col_limits', get: (r) => html`<span class="section__sub">${money(r.min_bet ?? r.minBet)} – ${money(r.max_bet ?? r.maxBet)}</span>` },
      { labelKey: 'admin.col_rtp', get: (r) => fmtPercent((r.rtp_bps ?? 9600) / 100, 2), num: true },
      { labelKey: 'admin.col_edge', get: (r) => fmtPercent((r.house_edge_bps ?? 0) / 100, 2), num: true },
      { labelKey: 'admin.col_plays', get: (r) => fmtNum(r.plays || 0), num: true },
      { labelKey: 'admin.col_visibility', get: (r) => chip(t(`admin.vis_${r.visibility}`), r.visibility === 'public' ? 'soft' : 'warn') },
      { labelKey: 'admin.col_enabled', get: (r) => html`<div class="row" style="gap:4px">${statusPill(r.enabled ? 'active' : 'closed')}${r.featured ? chip(t('admin.flag_featured'), 'gold') : ''}${r.is_new ? chip(t('admin.flag_new'), 'blue') : ''}</div>` },
      { labelKey: 'admin.col_actions', get: (r) => rowActions([
        { key: 'edit', icon: 'cog', labelKey: 'btn.edit', id: r.key },
        { key: 'toggle', icon: r.enabled ? 'eyeOff' : 'eye', labelKey: r.enabled ? 'admin.disable' : 'admin.enable', id: r.key },
      ]) },
    ],
    rows, emptyKey: 'admin.games_empty',
  })}
        </div>
      </section>`);
    wireTable(host, (key, action) => {
      const row = out.rows.find((r) => String(r.key) === String(key));
      if (action === 'toggle') {
        if (!isAdmin()) return toast(t('admin.need_admin'));
        return api.patch(`/admin/games/${key}`, { enabled: !row.enabled })
          .then(() => { toastOk(t('admin.game_updated')); TAB_FN.games(host, ctx); })
          .catch(toastError);
      }
      return editGameDialog(row, () => TAB_FN.games(host, ctx));
    }, { onForm: (fd) => navigate('/admin/games', { filters: { q: fd.get('q') }, replace: true }) });
    host.querySelector('[data-new]')?.addEventListener('click', () => newGameDialog(() => TAB_FN.games(host, ctx)));
  },

  // --------------------------------------------------------------------- live
  async live(host) {
    const out = await api.get('/admin/live-tables');
    paint(host, html`
      <section class="panel">
        <div class="panel__head">${icon('live', 16)}<h3>${t('admin.live_title')}</h3>
          <span class="grow"></span>
          <span class="row" style="gap:6px">${chip(`${t('admin.engine_live')}: ${out.enginesRunning.live ? t('btn.yes') : t('btn.no')}`, out.enginesRunning.live ? 'ok' : 'warn')}
            ${chip(`${t('admin.engine_crash')}: ${out.enginesRunning.crash ? t('btn.yes') : t('btn.no')}`, out.enginesRunning.crash ? 'ok' : 'warn')}</span></div>
        <div class="panel__body stack">
          <p class="section__sub">${t('admin.live_sub')}</p>
          ${dataTable({
    onRow: 'id',
    columns: [
      { labelKey: 'admin.col_table', get: (r) => html`<div><strong>${r.name}</strong><div class="section__sub">${r.studio || 'ArenaPlay Studio'} · ${r.engine}</div></div>` },
      { labelKey: 'admin.col_dealer', get: (r) => html`<span class="row" style="gap:6px">${icon('user', 13)} ${r.dealer_name || '—'}</span>` },
      { labelKey: 'admin.col_status', get: (r) => statusPill(r.status === 'open' ? 'live' : r.status === 'paused' ? 'paused' : 'closed') },
      { labelKey: 'admin.col_limits', get: (r) => html`<span class="section__sub">${money(r.min_bet)} – ${money(r.max_bet)}</span>` },
      { labelKey: 'admin.col_round', get: (r) => `${fmtNum(r.round_seconds)}s`, num: true },
      { labelKey: 'admin.col_enabled', get: (r) => statusPill(flag(r.enabled) ? 'active' : 'closed') },
      { labelKey: 'admin.col_actions', get: (r) => rowActions([{ key: 'edit', icon: 'cog', labelKey: 'btn.edit', id: r.id }]) },
    ],
    rows: out.rows, emptyKey: 'admin.live_empty',
  })}
          <p class="section__sub">${t('admin.live_hint')}</p>
        </div>
      </section>`);
    wireTable(host, (id) => editTableDialog(out.rows.find((r) => r.id === Number(id))));
  },

  // ------------------------------------------------------------------ content
  async content(host) {
    const [banners, announcements] = await Promise.all([api.get('/admin/banners').then((r) => r.rows), api.get('/admin/announcements').then((r) => r.rows)]);
    paint(host, html`
      <div class="stack">
        <section class="panel">
          <div class="panel__head">${icon('star', 16)}<h3>${t('admin.banners_title')}</h3><span class="grow"></span>
            ${isAdmin() ? html`<button class="btn btn--sm btn--gold" type="button" data-new-banner>${icon('plus', 15)} ${t('admin.new_banner')}</button>` : ''}</div>
          <div class="panel__body">
            ${banners.length ? banners.map((r) => html`
              <div class="admin-card">
                <div class="admin-card__media media--${r.media || r.accent || 'gold'}"><strong>${r.title}</strong>${r.subtitle ? html`<p>${r.subtitle}</p>` : ''}</div>
                <div class="grow">
                  <div class="row row--wrap" style="gap:6px">
                    ${chip(t('admin.col_sort') + ': ' + fmtNum(r.sort), 'soft')}
                    ${statusPill(r.active ? 'active' : 'closed')}
                    ${r.target ? chip(`${t('admin.col_target')}: ${r.target}`, 'blue') : ''}
                    ${r.badge ? chip(r.badge, 'gold') : ''}
                    ${r.clicks ? chip(`${t('admin.col_clicks')}: ${fmtNum(r.clicks)}`, 'soft') : ''}
                  </div>
                  ${r.titleBn ? html`<p class="section__sub">${r.titleBn} — ${r.subtitleBn || ''}</p>` : html`<p class="section__sub down">${t('admin.missing_bn')}</p>`}
                </div>
                <div class="row-actions">
                  ${isAdmin() ? rowActions([
    { key: 'banner-edit', icon: 'cog', labelKey: 'btn.edit', id: r.id },
    { key: 'banner-toggle', icon: r.active ? 'eyeOff' : 'eye', labelKey: r.active ? 'admin.deactivate' : 'admin.activate', id: r.id },
    { key: 'banner-del', icon: 'trash', labelKey: 'btn.delete', id: r.id, danger: true },
  ]) : ''}
                </div>
              </div>`) : emptyState({ titleKey: 'admin.banners_empty', bodyKey: 'admin.banners_empty_body' })}
          </div>
        </section>
        <section class="panel">
          <div class="panel__head">${icon('bell', 16)}<h3>${t('admin.ann_title')}</h3><span class="grow"></span>
            ${isAdmin() ? html`<button class="btn btn--sm btn--gold" type="button" data-new-ann>${icon('plus', 15)} ${t('admin.new_ann')}</button>` : ''}</div>
          <div class="panel__body">
            ${announcements.length ? announcements.map((r) => html`
              <div class="announce">
                <div class="announce__icon announce__icon--${r.type || 'info'}">${icon(r.type === 'bonus' ? 'gift' : r.type === 'maintenance' ? 'warn' : r.type === 'tournament' ? 'star' : 'info', 16)}</div>
                <div class="grow">
                  <div class="row row--wrap" style="gap:6px"><strong>${r.title}</strong>
                    ${chip(t(`admin.ann_${r.type || 'info'}`), r.type === 'maintenance' ? 'warn' : 'soft')}
                    ${statusPill(r.active ? 'active' : 'closed')}
                    <span class="section__sub">${when(r.startsAt || r.createdAt)}</span></div>
                  <p class="section__sub">${String(r.body || '').slice(0, 180)}${r.bodyBn ? html` · <span class="bn">${r.titleBn}</span>` : ''}</p>
                </div>
                ${isAdmin() ? rowActions([
    { key: 'ann-toggle', icon: r.active ? 'eyeOff' : 'eye', labelKey: r.active ? 'admin.deactivate' : 'admin.activate', id: r.id },
    { key: 'ann-del', icon: 'trash', labelKey: 'btn.delete', id: r.id, danger: true },
  ]) : ''}
              </div>`) : emptyState({ titleKey: 'admin.ann_empty', bodyKey: 'admin.ann_empty_body' })}
          </div>
        </section>
      </div>`);
    host.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
      const { action, id } = b.dataset;
      if (!isAdmin()) return toast(t('admin.need_admin'));
      try {
        if (action === 'banner-edit') return bannerDialog(banners.find((x) => x.id === Number(id)), () => TAB_FN.content(host));
        if (action === 'banner-toggle') { const row = banners.find((x) => x.id === Number(id)); await api.patch(`/admin/banners/${id}`, { active: !row.active }); toastOk(t('admin.banner_updated')); }
        if (action === 'banner-del') {
          if (!(await confirmDialog({ title: t('admin.delete_banner'), message: t('admin.delete_banner_body'), confirmKey: 'btn.delete', danger: true }))) return;
          await api.del(`/admin/banners/${id}`); toastOk(t('admin.banner_deleted'));
        }
        if (action === 'ann-toggle') { const row = announcements.find((x) => x.id === Number(id)); await api.patch(`/admin/announcements/${id}`, { active: !row.active }); toastOk(t('admin.ann_updated')); }
        if (action === 'ann-del') {
          if (!(await confirmDialog({ title: t('admin.delete_ann'), message: t('admin.delete_ann_body'), confirmKey: 'btn.delete', danger: true }))) return;
          await api.del(`/admin/announcements/${id}`); toastOk(t('admin.ann_deleted'));
        }
        TAB_FN.content(host);
      } catch (err) { toastError(err); }
    }));
    host.querySelector('[data-new-banner]')?.addEventListener('click', () => bannerDialog(null, () => TAB_FN.content(host)));
    host.querySelector('[data-new-ann]')?.addEventListener('click', () => announceDialog(() => TAB_FN.content(host)));
  },

  // ------------------------------------------------------------------- sports
  async sports(host, ctx) {
    const f = ctx.filters || {};
    const out = await api.get(`/admin/sports/fixtures?status=${f.status || ''}&sport=${f.sport || ''}&q=${encodeURIComponent(f.q || '')}&limit=40`);
    paint(host, html`
      <section class="panel">
        <div class="panel__head">${icon('sports', 16)}<h3>${t('admin.sports_title')}</h3><span class="grow"></span>
          ${isAdmin() ? html`<button class="btn btn--sm btn--gold" type="button" data-new-fixture>${icon('plus', 15)} ${t('admin.new_fixture')}</button>` : ''}</div>
        <div class="panel__body stack">
          <p class="section__sub">${t('admin.sports_sub')}</p>
          <form class="row row--wrap" data-search>
            <input class="input" name="q" placeholder="${t('admin.sports_search')}" value="${f.q || ''}" />
            <select class="select" name="sport"><option value="">${t('admin.sport_any')}</option>
              ${['cricket', 'football'].map((s) => html`<option value="${s}"${f.sport === s ? ' selected' : ''}>${t(`sports.sport.${s}`)}</option>`)}</select>
            <select class="select" name="status"><option value="">${t('admin.status_any')}</option>
              ${['scheduled', 'live', 'settled', 'cancelled', 'postponed'].map((s) => html`<option value="${s}"${f.status === s ? ' selected' : ''}>${t(`sports.status.${s}`)}</option>`)}</select>
            <button class="btn" type="submit">${icon('search', 15)} ${t('btn.filter')}</button>
          </form>
          ${dataTable({
    onRow: 'id',
    columns: [
      { labelKey: 'admin.col_fixture', get: (r) => html`<div><strong>${r.homeTeam?.name || r.home?.name || '—'} — ${r.awayTeam?.name || r.away?.name || '—'}</strong>
          <div class="section__sub">${r.league?.name || ''} · ${when(r.kickoff)}${r.venue ? ` · ${r.venue}` : ''}</div></div>` },
      { labelKey: 'admin.col_sport', get: (r) => chip(t(`sports.sport.${r.sport}`), 'soft') },
      { labelKey: 'admin.col_status', get: (r) => statusPill(r.status) },
      { labelKey: 'admin.col_score', get: (r) => (r.score ? `${fmtNum(r.score.home)}–${fmtNum(r.score.away)}` : '—'), num: true },
      { labelKey: 'admin.col_source', get: (r) => chip(t(r.source === 'provider' ? 'sports.source_provider' : 'sports.source_demo'), r.source === 'provider' ? 'ok' : 'gold') },
      { labelKey: 'admin.col_actions', get: (r) => rowActions([
        { key: 'odds', icon: 'chart', labelKey: 'admin.edit_odds', id: r.id },
        { key: 'live', icon: 'play', labelKey: 'admin.mark_live', id: r.id },
        { key: 'settle', icon: 'check', labelKey: 'admin.settle', id: r.id },
        { key: 'suspend', icon: 'lock', labelKey: 'admin.suspend_markets', id: r.id },
      ]) },
    ],
    rows: out.rows, emptyKey: 'admin.sports_empty',
  })}
          <p class="section__sub">${t('admin.sports_hint')}</p>
        </div>
      </section>`);
    wireTable(host, (id, action) => {
      const row = out.rows.find((r) => r.id === Number(id));
      if (action === 'odds') return oddsDialog(Number(id));
      if (!isAdmin()) return toast(t('admin.need_admin'));
      if (action === 'live') return api.patch(`/admin/sports/fixtures/${id}`, { status: 'live' }).then(() => { toastOk(t('admin.fixture_updated')); TAB_FN.sports(host, ctx); }).catch(toastError);
      if (action === 'suspend') return api.post(`/admin/sports/fixtures/${id}/markets/suspend`, { suspended: true }).then(() => { toastOk(t('admin.markets_suspended')); TAB_FN.sports(host, ctx); }).catch(toastError);
      if (action === 'settle') return settleDialog(row, () => TAB_FN.sports(host, ctx));
      return oddsDialog(Number(id));
    }, { onForm: (fd) => navigate('/admin/sports', { filters: { q: fd.get('q'), sport: fd.get('sport'), status: fd.get('status') }, replace: true }) });
    host.querySelector('[data-new-fixture]')?.addEventListener('click', () => newFixtureDialog(() => TAB_FN.sports(host, ctx)));
  },

  // ------------------------------------------------------------------- ledger
  async ledger(host, ctx) {
    const f = { kind: 'bets', ...ctx.filters };
    const qs = `userId=${f.userId || ''}&status=${f.status || ''}&game=${f.game || ''}&kind=${f.betKind || ''}&limit=50`;
    const out = await api.get(f.kind === 'bets' ? `/admin/bets?${qs}` : `/admin/transactions?${qs}`);
    const rows = out.rows || [];
    paint(host, html`
      <section class="panel">
        <div class="panel__head">
          <div class="tabs" role="tablist">
            <button class="tab" type="button" data-kind="bets" aria-selected="${String(f.kind === 'bets')}"><span>${t('admin.tab_bets')}</span></button>
            <button class="tab" type="button" data-kind="tx" aria-selected="${String(f.kind === 'tx')}"><span>${t('admin.tab_transactions')}</span></button>
          </div>
          <span class="grow"></span>
          <span class="section__sub">${t('admin.found', { total: fmtNum(out.total ?? rows.length) })}</span>
          ${isAdmin() ? html`<button class="btn btn--sm" type="button" data-export>${icon('download', 14)} ${t('admin.export_csv')}</button>` : ''}
        </div>
        <div class="panel__body stack">
          <form class="row row--wrap" data-search>
            <input class="input" name="userId" placeholder="${t('admin.by_user_id')}" value="${f.userId || ''}" inputmode="numeric" style="max-width:150px" />
            ${f.kind === 'bets' ? html`
              <input class="input" name="game" placeholder="${t('admin.by_game_key')}" value="${f.game || ''}" style="max-width:170px" />
              <select class="select" name="status"><option value="">${t('admin.status_any')}</option>
                ${['pending', 'won', 'lost', 'cashout', 'void', 'refunded'].map((s) => html`<option value="${s}"${f.status === s ? ' selected' : ''}>${t(`bet.status.${s}`)}</option>`)}</select>` : ''}
            <select class="select" name="betKind"><option value="">${t('admin.kind_any')}</option>
              ${(f.kind === 'bets' ? ['casino', 'sports'] : ['bet', 'win', 'bonus', 'admin_credit', 'admin_debit', 'refund', 'daily_bonus', 'signup_bonus']).map((s) => html`<option value="${s}"${f.betKind === s ? ' selected' : ''}>${t(`wallet.kind.${s}`, { defaultValue: s })}</option>`)}</select>
            <button class="btn" type="submit">${icon('search', 15)} ${t('btn.filter')}</button>
          </form>
          ${f.kind === 'bets' ? dataTable({
    columns: [
      { labelKey: 'admin.col_ref', get: (r) => html`<span class="mono">${r.publicId || r.public_id || r.id}</span>` },
      { labelKey: 'admin.col_player', get: (r) => html`<div><strong>${r.username}</strong><div class="section__sub mono">${r.email}</div></div>` },
      { labelKey: 'admin.col_game', get: (r) => `${r.game_key || r.gameKey || '—'} · ${r.kind}` },
      { labelKey: 'admin.col_stake', get: (r) => money(r.stake), num: true },
      { labelKey: 'admin.col_payout', get: (r) => money(r.payout), num: true },
      { labelKey: 'admin.col_mult', get: (r) => (r.multiplier ? `${(r.multiplier / 10000).toFixed(2)}×` : '—'), num: true },
      { labelKey: 'admin.col_status', get: (r) => statusPill(r.status, { keyBase: 'bet.status.' }) },
      { labelKey: 'admin.col_time', get: (r) => html`<span class="section__sub">${when(r.created_at || r.createdAt)}</span>` },
    ],
    rows, emptyKey: 'admin.ledger_empty',
  }) : dataTable({
    columns: [
      { labelKey: 'admin.col_player', get: (r) => html`<strong>${r.username || r.user_id}</strong>` },
      { labelKey: 'admin.col_kind', get: (r) => chip(t(`wallet.kind.${r.kind}`, { defaultValue: r.kind }), r.amount >= 0 ? 'ok' : 'soft') },
      { labelKey: 'admin.col_amount', get: (r) => html`<span class="${r.amount >= 0 ? 'up' : 'down'}">${money(r.amount)}</span>`, num: true },
      { labelKey: 'admin.col_balance', get: (r) => money(r.balance_after), num: true },
      { labelKey: 'admin.col_note', get: (r) => html`<span class="section__sub">${r.note_key ? t(r.note_key, { ...(r.note_params ? safeJson(r.note_params) : {}), defaultValue: r.note || r.note_key }) : (r.note || '—')}</span>` },
      { labelKey: 'admin.col_ref', get: (r) => html`<span class="mono section__sub">${r.reference || '—'}</span>` },
      { labelKey: 'admin.col_time', get: (r) => html`<span class="section__sub">${when(r.created_at)}</span>` },
    ],
    rows, emptyKey: 'admin.ledger_empty',
  })}
        </div>
      </section>`);
    host.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => navigate('/admin/ledger', { filters: { ...f, kind: b.dataset.kind }, replace: true })));
    wireTable(host, null, { onForm: (fd) => navigate('/admin/ledger', { filters: { ...f, userId: fd.get('userId'), game: fd.get('game'), status: fd.get('status'), betKind: fd.get('betKind') }, replace: true }) });
    host.querySelector('[data-export]')?.addEventListener('click', (ev) => downloadCsv(`/admin/export/${f.kind === 'bets' ? 'bets' : 'transactions'}?days=30`, `arenaplay-${f.kind}.csv`, ev.currentTarget));
  },

  // ------------------------------------------------------------------ tickets
  async tickets(host, ctx) {
    const status = ctx.filters?.status || 'open';
    const out = await api.get(`/admin/tickets?status=${status}`);
    const rows = out.rows || [];
    paint(host, html`
      <section class="panel">
        <div class="panel__head">${icon('chat', 16)}<h3>${t('admin.tickets_title')}</h3></div>
        <div class="panel__body stack">
          <div class="row row--wrap" style="gap:6px">
            ${['open', 'in_progress', 'answered', 'closed', 'all'].map((s) => html`
              <button class="btn btn--sm${s === status ? ' btn--gold' : ''}" type="button" data-status="${s}">${t(`ticket.status.${s}`, { defaultValue: s })}</button>`)}
            <span class="grow"></span><span class="section__sub">${t('admin.found', { total: fmtNum(rows.length) })}</span>
          </div>
          ${rows.length ? rows.map((r) => html`
            <div class="admin-card">
              <div class="grow">
                <div class="row row--wrap" style="gap:6px">
                  <span class="mono chip chip--soft">${r.ref}</span>
                  <strong>${r.subject}</strong>
                  ${chip(t(`ticket.priority.${r.priority}`, { defaultValue: r.priority }), r.priority === 'urgent' ? 'warn' : 'soft')}
                  ${statusPill(r.status, { keyBase: 'ticket.status.' })}
                </div>
                <p class="section__sub">${t('admin.ticket_from', { user: r.username, email: r.email })} · ${t(`ticket.cat.${r.category}`, { defaultValue: r.category })} · ${ago(r.updated_at)} · ${t('admin.col_msgs')}: ${fmtNum(r.msg_count)}</p>
              </div>
              ${rowActions([
    { key: 'open', icon: 'eye', labelKey: 'admin.open_ticket', id: r.id, ref: r.ref },
    { key: 'progress', icon: 'bolt', labelKey: 'admin.mark_progress', id: r.id },
    { key: 'close', icon: 'check', labelKey: 'admin.close_ticket', id: r.id },
  ])}
            </div>`) : emptyState({ titleKey: 'admin.tickets_empty', bodyKey: 'admin.tickets_empty_body' })}
        </div>
      </section>`);
    host.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => navigate('/admin/tickets', { filters: { status: b.dataset.status }, replace: true })));
    host.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
      const { action, id } = b.dataset;
      if (action === 'open') return ticketDialog(Number(id), b.dataset.ref, () => TAB_FN.tickets(host, ctx));
      if (!isAdmin()) return toast(t('admin.need_admin'));
      try {
        await api.patch(`/admin/tickets/${id}`, { status: action === 'close' ? 'closed' : 'in_progress' });
        toastOk(t(action === 'close' ? 'admin.ticket_closed' : 'admin.ticket_updated'));
        TAB_FN.tickets(host, ctx);
      } catch (err) { toastError(err); }
    }));
  },

  // ----------------------------------------------------------------- settings
  async settings(host) {
    const out = await api.get('/admin/settings');
    const e = out.effective || {};
    const body = document.createElement('div');
    buildForm(body, {
      layout: 'stack',
      submitKey: 'admin.save_settings',
      values: {
        site_name: e.site_name,
        default_locale: e.default_locale,
        registration_open: flag(e.registration_open),
        bets_enabled: flag(e.bets_enabled),
        live_enabled: flag(e.live_enabled),
        sports_enabled: flag(e.sports_enabled),
        demo_daily_bonus: flag(e.demo_daily_bonus),
        signup_bonus_cents: Number(e.signup_bonus_cents || 0),
        max_balance_cents: Number(e.max_balance_cents || 0),
        reality_check_every_min: Number(e.reality_check_every_min || 30),
        default_daily_loss_limit: Number(e.default_daily_loss_limit || 0),
        default_session_limit_min: Number(e.default_session_limit_min || 0),
        crash_growth: Number(e.crash_growth || 0.09),
        house_edge_bps: Number(e.house_edge_bps || 100),
        support_email: e.support_email || '',
        support_whatsapp: e.support_whatsapp || '',
        terms_version: e.terms_version || '1.0.0',
      },
      schema: {
        site_name: { maxLength: 40 },
        signup_bonus_cents: { min: 0, max: 100000000 },
        max_balance_cents: { min: 1000, max: 1000000000 },
        reality_check_every_min: { min: 5, max: 240 },
        default_daily_loss_limit: { min: 0, max: 100000000 },
        default_session_limit_min: { min: 0, max: 1440 },
        crash_growth: { min: 0.01, max: 0.5 },
        house_edge_bps: { min: 0, max: 2000 },
        support_email: { type: 'email' },
      },
      fields: [
        { name: 'site_name', labelKey: 'admin.f_site_name' },
        { name: 'default_locale', labelKey: 'admin.f_locale', type: 'select', options: [{ value: 'en', label: 'English' }, { value: 'bn', label: 'বাংলা' }] },
        { name: 'signup_bonus_cents', labelKey: 'admin.f_signup_bonus', type: 'cents' },
        { name: 'max_balance_cents', labelKey: 'admin.f_max_balance', type: 'cents' },
        { name: 'reality_check_every_min', labelKey: 'admin.f_reality', type: 'number' },
        { name: 'default_daily_loss_limit', labelKey: 'admin.f_default_loss', type: 'cents' },
        { name: 'default_session_limit_min', labelKey: 'admin.f_default_session', type: 'number' },
        { name: 'crash_growth', labelKey: 'admin.f_crash_growth', type: 'number', step: '0.01' },
        { name: 'house_edge_bps', labelKey: 'admin.f_house_edge', type: 'number' },
        { name: 'support_email', labelKey: 'admin.f_support_email', type: 'email' },
        { name: 'support_whatsapp', labelKey: 'admin.f_support_wa' },
        { name: 'terms_version', labelKey: 'admin.f_terms_version' },
        { name: 'registration_open', labelKey: 'admin.f_registration', type: 'checkbox', wide: true },
        { name: 'bets_enabled', labelKey: 'admin.f_bets', type: 'checkbox', wide: true },
        { name: 'live_enabled', labelKey: 'admin.f_live', type: 'checkbox', wide: true },
        { name: 'sports_enabled', labelKey: 'admin.f_sports', type: 'checkbox', wide: true },
        { name: 'demo_daily_bonus', labelKey: 'admin.f_daily_bonus', type: 'checkbox', wide: true },
      ],
      onSubmit: (v) => api.post('/admin/settings', { settings: v }).then((r) => { toastOk(t('admin.settings_saved')); return r; }),
    });
    paint(host, html`
      <div class="grid-2">
        <section class="panel">
          <div class="panel__head">${icon('cog', 16)}<h3>${t('admin.settings_title')}</h3></div>
          <div class="panel__body" data-form></div>
        </section>
        <div class="stack">
          <section class="panel">
            <div class="panel__head">${icon('warn', 16)}<h3>${t('admin.maintenance')}</h3></div>
            <div class="panel__body stack" data-maint>
              <p class="section__sub">${t('admin.maint_body')}</p>
              <button class="btn ${flag(e.maintenance_mode) ? '' : 'btn--warn'}" type="button" data-maint>${t(flag(e.maintenance_mode) ? 'admin.maint_end' : 'admin.maint_start')}</button>
            </div>
          </section>
          <section class="panel">
            <div class="panel__head">${icon('shield', 16)}<h3>${t('admin.settings_stored')}</h3>
              <span class="grow"></span><span class="section__sub">${t('admin.settings_hint')}</span></div>
            <div class="panel__body">
              ${Object.keys(out.stored || {}).length ? html`<dl class="kv">${Object.entries(out.stored).map(([k, v]) => html`
                <dt class="mono">${k}</dt><dd class="mono">${String(v)}</dd>`)}</dl>`
    : emptyState({ titleKey: 'admin.settings_none', bodyKey: 'admin.settings_none_body' })}
            </div>
          </section>
        </div>
      </div>`);
    host.querySelector('[data-form]').append(body);
    host.querySelector('[data-maint]')?.addEventListener('click', (ev) => toggleMaintenance(ev.currentTarget, () => TAB_FN.settings(host)));
  },

  // --------------------------------------------------------------------- logs
  async logs(host, ctx) {
    const f = ctx.filters || {};
    const [audit, errors, mail] = await Promise.all([
      api.get(`/admin/audit?action=${encodeURIComponent(f.action || '')}&limit=60`).then((r) => r),
      api.get(`/admin/errors${f.all ? '?all=1' : ''}`).then((r) => r.rows),
      api.get('/admin/mailbox?limit=30').then((r) => r.rows),
    ]);
    paint(host, html`
      <div class="stack">
        <section class="panel">
          <div class="panel__head">${icon('warn', 16)}<h3>${t('admin.errors_title')}</h3><span class="grow"></span>
            <button class="btn btn--sm" type="button" data-toggle-all>${t(f.all ? 'admin.errors_unresolved_only' : 'admin.errors_show_all')}</button></div>
          <div class="panel__body">${dataTable({
    onRow: 'id',
    columns: [
      { labelKey: 'admin.col_level', get: (r) => chip(r.level, r.level === 'error' ? 'warn' : 'soft') },
      { labelKey: 'admin.col_code', get: (r) => html`<span class="mono">${r.code || '—'}</span>` },
      { labelKey: 'admin.col_message', get: (r) => html`<div><span>${r.message}</span><div class="section__sub mono">${r.path || ''}</div></div>` },
      { labelKey: 'admin.col_hits', get: (r) => fmtNum(r.occurrences || 1), num: true },
      { labelKey: 'admin.col_user', get: (r) => html`<span class="section__sub mono">${r.user_email || '—'}</span>` },
      { labelKey: 'admin.col_seen', get: (r) => html`<span class="section__sub">${ago(r.last_seen_at || r.created_at)}</span>` },
      { labelKey: 'admin.col_actions', get: (r) => (flag(r.resolved) ? chip(t('admin.resolved'), 'ok') : rowActions([{ key: 'fix', icon: 'check', labelKey: 'admin.mark_resolved', id: r.id }])) },
    ],
    rows: errors, emptyKey: 'admin.errors_empty',
  })}</div>
        </section>
        <section class="panel">
          <div class="panel__head">${icon('clock', 16)}<h3>${t('admin.audit_title')}</h3>
            <span class="grow"></span><span class="section__sub">${t('admin.audit_total', { total: fmtNum(audit.total) })}</span></div>
          <div class="panel__body stack">
            <form class="row row--wrap" data-search>
              <input class="input" name="action" placeholder="${t('admin.audit_filter')}" value="${f.action || ''}" />
              <button class="btn" type="submit">${icon('search', 15)} ${t('btn.filter')}</button>
            </form>
            ${dataTable({
    columns: [
      { labelKey: 'admin.col_when', get: (r) => html`<span class="section__sub">${when(r.created_at)}</span>` },
      { labelKey: 'admin.col_actor', get: (r) => html`<div><span>${r.actor_email || t('admin.system')}</span><div class="section__sub">${r.actor_role || '—'}</div></div>` },
      { labelKey: 'admin.col_action', get: (r) => html`<span class="mono">${r.action}</span>` },
      { labelKey: 'admin.col_entity', get: (r) => html`<span class="section__sub mono">${r.entity || ''}${r.entity_id ? ` #${r.entity_id}` : ''}</span>` },
      { labelKey: 'admin.col_ip', get: (r) => html`<span class="section__sub mono">${r.ip_hash ? String(r.ip_hash).slice(0, 10) + '…' : '—'}</span>` },
      { labelKey: 'admin.col_meta', get: (r) => html`<span class="section__sub mono meta-cell">${JSON.stringify(r.meta ?? {}).slice(0, 120)}</span>` },
    ],
    rows: audit.rows, emptyKey: 'admin.audit_empty',
  })}
          </div>
        </section>
        <section class="panel">
          <div class="panel__head">${icon('mail', 16)}<h3>${t('admin.mail_title')}</h3>
            <span class="grow"></span><span class="section__sub">${t('admin.mail_hint')}</span></div>
          <div class="panel__body">${dataTable({
    columns: [
      { labelKey: 'admin.col_to', get: (r) => html`<span class="mono">${r.to_email}</span>` },
      { labelKey: 'admin.col_subject', key: 'subject' },
      { labelKey: 'admin.col_kind', get: (r) => chip(r.kind, 'soft') },
      { labelKey: 'admin.col_body', get: (r) => html`<span class="section__sub">${String(r.body || '').slice(0, 100)}</span>` },
      { labelKey: 'admin.col_status', get: (r) => statusPill(flag(r.delivered) ? 'answered' : 'pending') },
      { labelKey: 'admin.col_time', get: (r) => html`<span class="section__sub">${when(r.created_at)}</span>` },
    ],
    rows: mail, emptyKey: 'admin.mail_empty',
  })}</div>
        </section>
      </div>`);
    host.querySelector('[data-toggle-all]')?.addEventListener('click', () => navigate('/admin/logs', { filters: { ...f, all: !f.all }, replace: true }));
    wireTable(host, (id, action) => {
      if (action !== 'fix' || !isAdmin()) return action === 'fix' ? toast(t('admin.need_admin')) : null;
      return api.post(`/admin/errors/${id}/resolve`).then(() => { toastOk(t('admin.error_resolved')); TAB_FN.logs(host, ctx); }).catch(toastError);
    }, { onForm: (fd) => navigate('/admin/logs', { filters: { ...f, action: fd.get('action') }, replace: true }) });
  },
};

// ---------------------------------------------------------------------------
// shared wiring + dialogs
// ---------------------------------------------------------------------------
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

/** Delegated click wiring for dataTable rows/action buttons. */
function wireTable(host, onAction, { onForm, onPage } = {}) {
  host.querySelectorAll('form[data-search]').forEach((f) => f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    onForm?.(new FormData(f));
  }));
  host.querySelector('[data-prev]')?.addEventListener('click', () => onPage?.(-1));
  host.querySelector('[data-next]')?.addEventListener('click', () => onPage?.(1));
  if (!onAction) return;
  host.addEventListener('click', (ev) => {
    const btn = ev.target.closest?.('[data-action]');
    const row = ev.target.closest?.('[data-row]');
    if (btn) { ev.preventDefault(); return onAction(btn.dataset.id, btn.dataset.action, btn); }
    if (row) return onAction(row.dataset.row, 'view', row);
  });
}

async function downloadCsv(path, filename, btn) {
  btn?.setAttribute('aria-busy', 'true');
  try {
    const blob = await api.file(path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toastOk(t('admin.export_ready'));
  } catch (err) { toastError(err); } finally { btn?.removeAttribute('aria-busy'); }
}

function toggleMaintenance(btn, after) {
  const on = !flag(state.adminOverview?.overview?.maintenance) && btn.dataset.on !== '1';
  btn.disabled = true;
  return api.post('/admin/maintenance', { on })
    .then(() => {
      btn.dataset.on = on ? '1' : '';
      toastOk(t(on ? 'admin.maint_started' : 'admin.maint_ended'));
      after?.();
    })
    .catch(toastError)
    .finally(() => { btn.disabled = false; });
}

function openUser(id, after) {
  api.get(`/admin/users/${id}`).then((d) => {
    const body = document.createElement('div');
    paint(body, html`
      <div class="stack">
        <div class="row" style="gap:10px">
          <span class="avatar">${icon('user', 22)}</span>
          <div class="grow"><strong>${d.user.username}</strong><div class="section__sub mono">${d.user.email}</div></div>
          ${statusPill(d.user.status)}${chip(t(`user.role.${d.user.role}`), d.user.role === 'admin' ? 'gold' : 'soft')}
        </div>
        <dl class="kv">
          <dt>${t('admin.col_balance')}</dt><dd>${money(d.wallet.balance)}</dd>
          <dt>${t('admin.col_wagered')}</dt><dd>${money(d.wallet.lifetimeWagered)}</dd>
          <dt>${t('admin.col_won')}</dt><dd>${money(d.wallet.lifetimeWon)}</dd>
          <dt>${t('admin.col_joined')}</dt><dd>${when(d.user.createdAt)}</dd>
          <dt>${t('admin.col_seen')}</dt><dd>${when(d.user.lastLoginAt)}</dd>
          <dt>${t('admin.col_lang')}</dt><dd>${d.user.locale === 'bn' ? 'বাংলা' : 'English'}</dd>
          <dt>${t('rg.daily_loss')}</dt><dd>${d.user.limits?.dailyLossLimit ? money(d.user.limits.dailyLossLimit) : t('rg.no_limit')}</dd>
          <dt>${t('rg.self_exclude')}</dt><dd>${d.user.selfExclusionUntil ? when(d.user.selfExclusionUntil) : t('rg.no_limit')}</dd>
        </dl>
        <h4>${t('admin.recent_bets')}</h4>
        ${dataTable({
    columns: [
      { labelKey: 'admin.col_game', get: (r) => r.gameKey || r.game_key || '—' },
      { labelKey: 'admin.col_stake', get: (r) => money(r.stake ?? r.stakeCents), num: true },
      { labelKey: 'admin.col_payout', get: (r) => money(r.payout), num: true },
      { labelKey: 'admin.col_status', get: (r) => statusPill(r.status, { keyBase: 'bet.status.' }) },
    ],
    rows: d.bets || [], emptyKey: 'admin.ledger_empty',
  })}
        <h4>${t('admin.recent_tx')}</h4>
        ${dataTable({
    columns: [
      { labelKey: 'admin.col_kind', get: (r) => t(`wallet.kind.${r.kind}`, { defaultValue: r.kind }) },
      { labelKey: 'admin.col_amount', get: (r) => money(r.amount), num: true },
      { labelKey: 'admin.col_time', get: (r) => when(r.created_at || r.createdAt) },
    ],
    rows: d.transactions || [], emptyKey: 'admin.ledger_empty',
  })}
        <h4>${t('admin.sessions_title')}</h4>
        ${(d.sessions || []).length ? html`<ul class="list-dim">${d.sessions.map((s) => html`
          <li class="row"><span class="mono section__sub">${s.id}</span><span class="grow"></span>
            <span class="section__sub">${when(s.lastSeenAt || s.createdAt)}</span></li>`)}</ul>`
        : html`<p class="section__sub">${t('admin.sessions_empty')}</p>`}
        ${(d.tickets || []).length ? html`
          <h4>${t('admin.tab_tickets')}</h4>
          <ul class="list-dim">${d.tickets.map((x) => html`<li class="row"><span class="mono">${x.ref}</span>
            <span class="grow">${x.subject}</span>${statusPill(x.status, { keyBase: 'ticket.status.' })}</li>`)}</ul>` : ''}
        <h4>${t('admin.audit_title')}</h4>
        ${(d.audit || []).length ? html`<ul class="list-dim">${d.audit.slice(0, 12).map((a) => html`
          <li class="row"><span class="mono section__sub">${a.action}</span><span class="grow"></span>
            <span class="section__sub">${when(a.created_at)}</span></li>`)}</ul>`
        : html`<p class="section__sub">${t('admin.audit_empty')}</p>`}
        ${isAdmin() ? html`
          <div class="row row--wrap" style="gap:6px">
            <button class="btn btn--gold" type="button" data-act="credits">${icon('wallet', 15)} ${t('admin.grant_credits')}</button>
            <button class="btn" type="button" data-act="role">${icon('shield', 15)} ${t('admin.change_role')}</button>
            <button class="btn" type="button" data-act="suspend">${t(d.user.status === 'suspended' ? 'admin.activate' : 'admin.suspend')}</button>
            <button class="btn" type="button" data-act="unlock">${icon('check', 15)} ${t('admin.unlock_account')}</button>
            <button class="btn" type="button" data-act="exclude">${icon('lock', 15)} ${t(d.user.selfExclusionUntil ? 'admin.lift_exclusion' : 'admin.self_exclude_24h')}</button>
            <button class="btn" type="button" data-act="password">${icon('key', 15)} ${t('admin.reset_password')}</button>
          </div>` : html`<p class="section__sub">${t('admin.moderator_readonly')}</p>`}
      </div>`);
    modal({ title: `${t('admin.user_detail')} — ${d.user.username}`, body, wide: true });
    body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'credits') return grantCreditsDialog(d.user.id, after);
      if (act === 'role') return roleDialog(d.user, after);
      if (act === 'password') return passwordResetDialog(d.user, after);
      if (!isAdmin()) return toast(t('admin.need_admin'));
      if (act === 'suspend') return patchUser(d.user.id, { status: d.user.status === 'suspended' ? 'active' : 'suspended' }, after);
      if (act === 'unlock') return patchUser(d.user.id, { lockedUntil: null }, after);
      if (act === 'exclude') return patchUser(d.user.id, { selfExclusionUntil: d.user.selfExclusionUntil ? null : new Date(Date.now() + 86400000).toISOString().slice(0, 19) }, after);
      return null;
    }));
  }).catch(toastError);
}

function patchUser(id, patch, after) {
  if (!isAdmin()) return toast(t('admin.need_admin'));
  return api.patch(`/admin/users/${id}`, patch)
    .then(() => { toastOk(t('admin.user_updated')); after?.(); })
    .catch(toastError);
}

function grantCreditsDialog(id, after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'stack',
    submitKey: 'admin.grant_credits',
    fields: [
      { name: 'amountCents', labelKey: 'admin.f_amount', type: 'cents', required: true, hintKey: 'admin.f_amount_hint' },
      { name: 'reason', labelKey: 'admin.f_reason', required: true, placeholderKey: 'admin.f_reason_ph', wide: true },
    ],
    schema: { reason: { min: 4, maxLength: 200 } },
    onSubmit: (v) => api.post(`/admin/users/${id}/credits`, v).then((r) => { toastOk(t('admin.credits_ok', { balance: money(r.balance) })); after?.(); return r; }),
  });
  modal({ title: t('admin.grant_credits'), body });
}

function notifyUserDialog(id) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'stack',
    submitKey: 'btn.send',
    values: { titleKey: 'notif.admin_message', level: 'info' },
    fields: [
      { name: 'titleKey', labelKey: 'admin.f_title_key', required: true, hintKey: 'admin.f_title_key_hint' },
      { name: 'bodyKey', labelKey: 'admin.f_body_key', placeholderKey: 'admin.f_body_key_ph' },
      { name: 'level', labelKey: 'admin.f_level', type: 'select', options: ['info', 'success', 'warn', 'error'].map((v) => ({ value: v, label: v })) },
      { name: 'link', labelKey: 'admin.f_link', placeholder: '/account' },
    ],
    onSubmit: (v) => api.post(`/admin/users/${id}/notify`, v).then(() => toastOk(t('admin.notif_sent'))),
  });
  modal({ title: t('admin.notify_user'), body });
}

function roleDialog(user, after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'stack',
    submitKey: 'btn.save',
    values: { role: user.role, status: user.status },
    fields: [
      { name: 'role', labelKey: 'admin.col_role', type: 'select', options: ['user', 'moderator', 'admin'].map((v) => ({ value: v, labelKey: `user.role.${v}` })) },
      { name: 'status', labelKey: 'admin.col_status', type: 'select', options: ['active', 'suspended', 'closed'].map((v) => ({ value: v, labelKey: `user.status.${v}` })) },
    ],
    onSubmit: (v) => api.patch(`/admin/users/${user.id}`, v).then((r) => { toastOk(t('admin.user_updated')); after?.(); return r; }),
  });
  modal({ title: t('admin.change_role'), body });
}

function passwordResetDialog(user, after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'stack',
    submitKey: 'admin.reset_password',
    fields: [{ name: 'resetPassword', labelKey: 'admin.f_new_password', type: 'password', required: true, strength: true, wide: true, hintKey: 'auth.pw_rules' }],
    onSubmit: (v) => api.patch(`/admin/users/${user.id}`, { resetPassword: v.resetPassword }).then((r) => { toastOk(t('admin.password_reset')); after?.(); return r; }),
  });
  modal({ title: `${t('admin.reset_password')} — ${user.username}`, body });
}

function editGameDialog(row, after) {
  if (!row) return;
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: 'btn.save',
    values: {
      name: row.name, nameKey: row.name_key || `game.${row.key}`, minBet: row.min_bet ?? row.minBet, maxBet: row.max_bet ?? row.maxBet,
      rtpBps: row.rtp_bps, houseEdgeBps: row.house_edge_bps, category: row.category, volatility: row.volatility,
      visibility: row.visibility, accent: row.accent || 'gold', emoji: row.emoji || '', popularity: row.popularity || 0, sort: row.sort || 100,
      descriptionKey: row.description_key || '', enabled: flag(row.enabled), featured: flag(row.featured), isNew: flag(row.is_new),
    },
    fields: [
      { name: 'name', labelKey: 'admin.f_name', required: true },
      { name: 'nameKey', labelKey: 'admin.f_name_key' },
      { name: 'category', labelKey: 'admin.f_category', type: 'select', options: ['slots', 'table', 'cards', 'live', 'crash', 'arcade'].map((v) => ({ value: v, labelKey: `cat.${v}` })) },
      { name: 'visibility', labelKey: 'admin.f_vis', type: 'select', options: ['public', 'logged_in', 'hidden'].map((v) => ({ value: v, labelKey: `admin.vis_${v}` })) },
      { name: 'minBet', labelKey: 'admin.f_min', type: 'cents' },
      { name: 'maxBet', labelKey: 'admin.f_max', type: 'cents' },
      { name: 'rtpBps', labelKey: 'admin.f_rtp', type: 'number', hintKey: 'admin.f_rtp_hint' },
      { name: 'houseEdgeBps', labelKey: 'admin.f_edge', type: 'number' },
      { name: 'volatility', labelKey: 'admin.f_vol', type: 'select', options: ['low', 'medium', 'high'].map((v) => ({ value: v, labelKey: `game.vol_${v}` })) },
      { name: 'accent', labelKey: 'admin.f_accent' },
      { name: 'emoji', labelKey: 'admin.f_emoji' },
      { name: 'popularity', labelKey: 'admin.f_pop', type: 'number' },
      { name: 'sort', labelKey: 'admin.f_sort', type: 'number' },
      { name: 'descriptionKey', labelKey: 'admin.f_desc_key', placeholder: 'gameDesc.lucky_tiger', wide: true },
      { name: 'enabled', labelKey: 'admin.f_enabled', type: 'checkbox' },
      { name: 'featured', labelKey: 'admin.f_featured', type: 'checkbox' },
      { name: 'isNew', labelKey: 'admin.f_new', type: 'checkbox' },
    ],
    schema: {
      name: { maxLength: 60 }, minBet: { min: 10 }, maxBet: { min: 10 },
      rtpBps: { min: 5000, max: 10000 }, houseEdgeBps: { min: 0, max: 2000 }, popularity: { min: 0, max: 100000 }, sort: { min: 0, max: 9999 },
    },
    onSubmit: (v) => api.patch(`/admin/games/${row.key}`, v).then((r) => { toastOk(t('admin.game_updated')); after?.(); return r; }),
  });
  modal({ title: `${t('admin.edit_game')} — ${row.name}`, body, wide: true });
}

function newGameDialog(after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: 'admin.create_game',
    values: { engine: 'slots', category: 'slots', minBet: 100, maxBet: 500000, rtpBps: 9600, houseEdgeBps: 200, volatility: 'medium', layout: 'card', accent: 'gold', sort: 100, enabled: true, isNew: true },
    fields: [
      { name: 'key', labelKey: 'admin.f_key', required: true, placeholder: 'lucky_dragon', hintKey: 'admin.f_key_hint' },
      { name: 'name', labelKey: 'admin.f_name', required: true, placeholder: 'Lucky Dragon' },
      { name: 'engine', labelKey: 'admin.f_engine', type: 'select', options: ['slots', 'roulette', 'dice', 'mines', 'wheel', 'plinko', 'bingo', 'blackjack', 'baccarat', 'three_patti', 'video_poker', 'crash', 'live'].map((v) => ({ value: v, labelKey: `game.${v}` })) },
      { name: 'category', labelKey: 'admin.f_category', type: 'select', options: ['slots', 'table', 'cards', 'live', 'crash', 'arcade'].map((v) => ({ value: v, labelKey: `cat.${v}` })) },
      { name: 'minBet', labelKey: 'admin.f_min', type: 'cents' },
      { name: 'maxBet', labelKey: 'admin.f_max', type: 'cents' },
      { name: 'rtpBps', labelKey: 'admin.f_rtp', type: 'number' },
      { name: 'houseEdgeBps', labelKey: 'admin.f_edge', type: 'number' },
      { name: 'volatility', labelKey: 'admin.f_vol', type: 'select', options: ['low', 'medium', 'high'].map((v) => ({ value: v, labelKey: `game.vol_${v}` })) },
      { name: 'layout', labelKey: 'admin.f_layout', type: 'select', options: ['card', 'wide', 'hero', 'live'].map((v) => ({ value: v, label: v })) },
      { name: 'accent', labelKey: 'admin.f_accent', placeholder: 'gold' },
      { name: 'sort', labelKey: 'admin.f_sort', type: 'number' },
      { name: 'enabled', labelKey: 'admin.f_enabled', type: 'checkbox' },
      { name: 'featured', labelKey: 'admin.f_featured', type: 'checkbox' },
      { name: 'isNew', labelKey: 'admin.f_new', type: 'checkbox' },
    ],
    onSubmit: (v) => api.post('/admin/games', v).then((r) => { toastOk(t('admin.game_created')); after?.(); return r; }),
  });
  modal({ title: t('admin.new_game'), body, wide: true });
}

function editTableDialog(row, after) {
  if (!row) return;
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: 'btn.save',
    values: { name: row.name, dealerName: row.dealer_name, studio: row.studio, status: row.status, minBet: row.min_bet, maxBet: row.max_bet, roundSeconds: row.round_seconds, sort: row.sort, enabled: flag(row.enabled) },
    fields: [
      { name: 'name', labelKey: 'admin.f_name' },
      { name: 'dealerName', labelKey: 'admin.f_dealer' },
      { name: 'studio', labelKey: 'admin.f_studio' },
      { name: 'status', labelKey: 'admin.col_status', type: 'select', options: ['open', 'paused', 'closed'].map((v) => ({ value: v, labelKey: `admin.tbl_${v}` })) },
      { name: 'minBet', labelKey: 'admin.f_min', type: 'cents' },
      { name: 'maxBet', labelKey: 'admin.f_max', type: 'cents' },
      { name: 'roundSeconds', labelKey: 'admin.f_round', type: 'number' },
      { name: 'sort', labelKey: 'admin.f_sort', type: 'number' },
      { name: 'enabled', labelKey: 'admin.f_enabled', type: 'checkbox' },
    ],
    schema: { minBet: { min: 10 }, maxBet: { min: 10 }, roundSeconds: { min: 5, max: 600 } },
    onSubmit: (v) => api.patch(`/admin/live-tables/${row.id}`, v).then(() => { toastOk(t('admin.table_updated')); after?.(); }),
  });
  modal({ title: `${t('admin.edit_table')} — ${row.name}`, body });
}

function bannerDialog(row, after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: row ? 'btn.save' : 'btn.create',
    values: row ? {
      titleEn: row.title, subtitleEn: row.subtitle, ctaEn: row.cta, titleBn: row.titleBn, subtitleBn: row.subtitleBn, ctaBn: row.ctaBn,
      badge: row.badge, target: row.target, media: row.media, accent: row.accent, sort: row.sort, active: row.active, startsAt: (row.startsAt || '').slice(0, 10), endsAt: (row.endsAt || '').slice(0, 10),
    } : { accent: 'gold', media: 'gold', sort: 100, active: true },
    fields: [
      { name: 'titleEn', labelKey: 'admin.f_title_en', required: true },
      { name: 'titleBn', labelKey: 'admin.f_title_bn' },
      { name: 'subtitleEn', labelKey: 'admin.f_sub_en', textarea: true, wide: true },
      { name: 'subtitleBn', labelKey: 'admin.f_sub_bn', textarea: true, wide: true },
      { name: 'ctaEn', labelKey: 'admin.f_cta_en' },
      { name: 'ctaBn', labelKey: 'admin.f_cta_bn' },
      { name: 'badge', labelKey: 'admin.f_badge' },
      { name: 'media', labelKey: 'admin.f_media', type: 'select', options: ['gold', 'blue', 'violet', 'green', 'sunset', 'rose', 'grid'].map((v) => ({ value: v, label: v })) },
      { name: 'target', labelKey: 'admin.f_target', placeholder: '/casino/slots', wide: true },
      { name: 'accent', labelKey: 'admin.f_accent' },
      { name: 'sort', labelKey: 'admin.f_sort', type: 'number' },
      { name: 'startsAt', labelKey: 'admin.f_starts', type: 'date' },
      { name: 'endsAt', labelKey: 'admin.f_ends', type: 'date' },
      { name: 'active', labelKey: 'admin.f_active', type: 'checkbox' },
    ],
    schema: { titleEn: { min: 3, maxLength: 120 }, subtitleEn: { maxLength: 240 }, badge: { maxLength: 30 }, target: { maxLength: 120 } },
    onSubmit: (v) => (row ? api.patch(`/admin/banners/${row.id}`, v) : api.post('/admin/banners', v))
      .then(() => { toastOk(t(row ? 'admin.banner_updated' : 'admin.banner_created')); after?.(); }),
  });
  modal({ title: row ? t('admin.edit_banner') : t('admin.new_banner'), body, wide: true });
}

function announceDialog(after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: 'admin.publish',
    values: { type: 'info', active: true, pushToUsers: false },
    fields: [
      { name: 'titleEn', labelKey: 'admin.f_title_en', required: true, wide: true },
      { name: 'titleBn', labelKey: 'admin.f_title_bn', wide: true },
      { name: 'bodyEn', labelKey: 'admin.f_body_en', textarea: true, required: true, wide: true },
      { name: 'bodyBn', labelKey: 'admin.f_body_bn', textarea: true, wide: true },
      { name: 'type', labelKey: 'admin.f_ann_type', type: 'select', options: ['info', 'bonus', 'maintenance', 'tournament', 'warn'].map((v) => ({ value: v, labelKey: `admin.ann_${v}` })) },
      { name: 'link', labelKey: 'admin.f_link', placeholder: '/casino' },
      { name: 'startsAt', labelKey: 'admin.f_starts', type: 'date' },
      { name: 'endsAt', labelKey: 'admin.f_ends', type: 'date' },
      { name: 'active', labelKey: 'admin.f_active', type: 'checkbox' },
      { name: 'pushToUsers', labelKey: 'admin.f_push', type: 'checkbox' },
    ],
    schema: { titleEn: { min: 4, maxLength: 160 }, bodyEn: { min: 8, maxLength: 2000 } },
    onSubmit: (v) => api.post('/admin/announcements', v).then(() => { toastOk(t('admin.ann_published')); after?.(); }),
  });
  modal({ title: t('admin.new_ann'), body, wide: true });
}

function oddsDialog(fixtureId, after) {
  api.get(`/sports/fixtures/${fixtureId}`).then((d) => {
    const fx = d.fixture;
    const markets = fx.marketList || fx.markets || [];
    const body = document.createElement('div');
    paint(body, html`
      <div class="stack">
        <p class="section__sub">${fx.home?.name} — ${fx.away?.name} · ${when(fx.kickoff)}</p>
        ${markets.length ? markets.map((m) => html`
          <section>
            <div class="row" style="gap:6px"><h4>${t(m.labelKey, m.params || {})}</h4>${statusPill(m.status)}${m.suspended ? chip(t('sports.suspended'), 'warn') : ''}</div>
            <div class="stack stack--tight">${(m.selections || []).map((s) => html`
              <div class="row" style="gap:8px">
                <span class="grow">${t(s.labelKey, s.params || {})}</span>
                <input class="input" style="max-width:120px" type="number" step="0.01" min="1.01" value="${(s.odds / 10000).toFixed(2)}" data-sel="${s.id}" aria-label="${t('admin.f_odds')}" />
                <button class="btn btn--sm" type="button" data-save="${s.id}">${t('btn.save')}</button>
              </div>`)}</div>
          </section>`) : html`<p class="section__sub">${t('admin.no_markets')}</p>`}
        <p class="section__sub">${t('admin.odds_hint')}</p>
      </div>`);
    modal({ title: t('admin.edit_odds'), body, wide: true });
    body.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', async () => {
      if (!isAdmin()) return toast(t('admin.need_admin'));
      const id = b.dataset.save;
      const input = body.querySelector(`[data-sel="${id}"]`);
      const odds = Number(input.value);
      if (!Number.isFinite(odds) || odds < 1.01) return toast(t('sports.odds_invalid'));
      b.disabled = true;
      try { await api.patch(`/admin/sports/selections/${id}`, { odds }); toastOk(t('admin.odds_updated')); after?.(); }
      catch (err) { toastError(err); } finally { b.disabled = false; }
    }));
  }).catch(toastError);
}

function newFixtureDialog(after) {
  api.get('/sports/leagues').then((l) => {
    const body = document.createElement('div');
    buildForm(body, {
      layout: 'grid',
      submitKey: 'admin.create_fixture',
      values: { sport: 'cricket', liveSim: true, season: '2026' },
      fields: [
        { name: 'sport', labelKey: 'admin.col_sport', type: 'select', options: [{ value: 'cricket', labelKey: 'sports.sport.cricket' }, { value: 'football', labelKey: 'sports.sport.football' }] },
        { name: 'leagueId', labelKey: 'admin.f_league', type: 'select', options: (l.rows || []).map((x) => ({ value: x.id, label: x.name })) },
        { name: 'home', labelKey: 'admin.f_home', required: true },
        { name: 'away', labelKey: 'admin.f_away', required: true },
        { name: 'kickoff', labelKey: 'admin.f_kickoff', required: true, placeholder: '2026-10-20 18:30', hintKey: 'admin.f_kickoff_hint' },
        { name: 'venue', labelKey: 'admin.f_venue' },
        { name: 'round', labelKey: 'admin.f_round' },
        { name: 'season', labelKey: 'admin.f_season' },
        { name: 'liveSim', labelKey: 'admin.f_live_sim', type: 'checkbox' },
      ],
      schema: { home: { min: 2, maxLength: 60 }, away: { min: 2, maxLength: 60 }, kickoff: { pattern: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/, key: 'val.datetime' } },
      onSubmit: (v) => api.post('/admin/sports/fixtures', v).then(() => { toastOk(t('admin.fixture_created')); after?.(); }),
    });
    modal({ title: t('admin.new_fixture'), body });
  }).catch(toastError);
}

function settleDialog(row, after) {
  const body = document.createElement('div');
  buildForm(body, {
    layout: 'grid',
    submitKey: 'admin.settle',
    variant: 'gold',
    values: { status: 'settled', winner: 'home' },
    fields: [
      { name: 'status', labelKey: 'admin.f_settle_status', type: 'select', options: [{ value: 'settled', labelKey: 'sports.status.settled' }, { value: 'cancelled', labelKey: 'sports.status.cancelled' }] },
      { name: 'winner', labelKey: 'admin.f_winner', type: 'select', options: [{ value: 'home', labelKey: 'market.1x2.home' }, { value: 'draw', labelKey: 'market.1x2.draw' }, { value: 'away', labelKey: 'market.1x2.away' }] },
      { name: 'homeScore', labelKey: 'admin.f_home_score', type: 'number' },
      { name: 'awayScore', labelKey: 'admin.f_away_score', type: 'number' },
    ],
    onSubmit: (v) => api.patch(`/admin/sports/fixtures/${row.id}`, v)
      .then(() => (v.status === 'settled' ? api.post(`/admin/sports/fixtures/${row.id}/settle`, {}) : { ok: true }))
      .then(() => { toastOk(t('admin.fixture_settled')); after?.(); }),
  });
  modal({ title: `${t('admin.settle')} — ${row?.homeTeam?.name || row?.home?.name || ''} — ${row?.awayTeam?.name || row?.away?.name || ''}`, body });
}

function ticketDialog(id, ref, after) {
  api.get(`/tickets/${ref}`).then((d) => {
    const body = document.createElement('div');
    paint(body, html`
      <div class="stack">
        <div class="row row--wrap" style="gap:6px">
          <span class="mono chip chip--soft">${d.ticket.ref}</span>${statusPill(d.ticket.status, { keyBase: 'ticket.status.' })}
          ${chip(t(`ticket.priority.${d.ticket.priority}`, { defaultValue: d.ticket.priority }), d.ticket.priority === 'urgent' ? 'warn' : 'soft')}
          ${chip(t(`ticket.cat.${d.ticket.category}`, { defaultValue: d.ticket.category }), 'soft')}
        </div>
        <h3>${d.ticket.subject}</h3>
        <div class="thread">${(d.messages || []).map((m) => html`
          <div class="msg${m.fromAdmin ? ' msg--staff' : ''}">
            <div class="msg__head"><strong>${m.author || t('admin.system')}</strong><span class="section__sub">${when(m.createdAt)}</span></div>
            <p>${m.body}</p></div>`)}
        </div>
        ${d.ticket.status === 'closed' ? html`<p class="section__sub">${t('ticket.closed_hint')}</p>` : html`
          <form class="stack" data-reply>
            <label class="field__label" for="ticket-reply">${t('admin.reply')}</label>
            <textarea class="input" id="ticket-reply" name="body" rows="4" required></textarea>
            <div class="row row--wrap">
              <button class="btn btn--gold" type="submit">${icon('send', 15)} ${t('btn.send')}</button>
              <button class="btn btn--warn" type="button" data-close>${t('admin.close_ticket')}</button>
            </div>
          </form>`}
      </div>`);
    modal({ title: `${t('admin.open_ticket')} — ${d.ticket.ref}`, body, wide: true });
    body.querySelector('[data-reply]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api.post(`/admin/tickets/${id}/reply`, { body: body.querySelector('[name=body]').value.trim() });
        toastOk(t('admin.reply_sent'));
        after?.();
      } catch (err) { toastError(err); } finally { btn.disabled = false; }
    });
    body.querySelector('[data-close]')?.addEventListener('click', async () => {
      try { await api.patch(`/admin/tickets/${id}`, { status: 'closed' }); toastOk(t('admin.ticket_closed')); after?.(); } catch (err) { toastError(err); }
    });
  }).catch(toastError);
}

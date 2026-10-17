/** Reusable view pieces shared by the pages. Pure functions of (data) → html. */
import { html, raw, icon, render } from '../core/dom.js';
import { t, isBengali, fmtCredits, fmtNum, fmtDateTime, fmtRelative, fmtMultiplier, fmtOdds, fmtPercent } from '../core/i18n.js';
import { clampNum } from '../core/ui.js';

export const GAME_GLYPH = {
  slots: '🎰', roulette: '🎡', blackjack: '🃏', baccarat: '♠️', video_poker: '🂡', three_patti: '🎴',
  dice: '🎲', mines: '💣', wheel: '🎯', plinko: '🔻', bingo: '🅱️', crash: '🚀',
  roulette_live: '🎡', blackjack_live: '🃏', baccarat_live: '🎶', wheel_live: '🎯',
};
export const gameGlyph = (game) => GAME_GLYPH[game?.engine] || GAME_GLYPH[game?.key] || '✨';
export const accentFor = (game) => game?.accent || 'gold';

export function pageHeader({ titleKey, title, subKey, sub, actions = '' }) {
  return html`
    <div class="section__head">
      <div class="grow">
        <h1 class="section__title" ${titleKey ? `data-i18n="${titleKey}"` : ''}>${titleKey ? t(titleKey) : title}</h1>
        ${subKey || sub ? html`<p class="section__sub" ${subKey ? `data-i18n="${subKey}"` : ''}>${subKey ? t(subKey) : sub}</p>` : ''}
      </div>
      ${actions}
    </div>`;
}

export const demoNotice = (key = 'compliance.demo_short') => html`
  <div class="notice notice--gold" role="note">
    <span class="notice__icon">${icon('info', 18)}</span>
    <div><strong>${t('app.demo_badge')}</strong> — <span data-i18n="${key}">${t(key)}</span></div>
  </div>`;

export function gameCard(game, { favorite = false, showRtp = true } = {}) {
  const name = game.nameKey ? t(game.nameKey) : game.name;
  return html`
    <a class="card" href="/game/${game.key}" data-link aria-label="${name}">
      <div class="card__art art--${accentFor(game)}">
        <span class="card__badges">
          ${game.isNew ? html`<span class="chip chip--gold">${t('game.new')}</span>` : ''}
          ${game.popularity > 50 ? html`<span class="chip chip--red">${t('game.hot')}</span>` : ''}
          ${game.multiStep ? html`<span class="chip chip--blue">${t('game.skill')}</span>` : ''}
        </span>
        <button class="card__fav" type="button" data-fav="${game.key}" aria-pressed="${String(favorite)}"
          aria-label="${t('game.favorite')}" data-i18n-aria="game.favorite">${icon('star', 15)}</button>
        <span class="card__glyph" aria-hidden="true">${gameGlyph(game)}</span>
      </div>
      <div class="card__body">
        <div class="card__title">${name}</div>
        <div class="card__meta">
          <span>${t(game.category ? `cat.${game.category}` : 'cat.table')}</span>
          ${showRtp && game.rtpBps ? html`<span>· ${t('game.rtp')} ${fmtPercent(game.rtpBps)}</span>` : ''}
        </div>
        <div class="card__meta">
          <span>${t('game.min')} ${fmtCredits(game.minBet || 0)}</span>
          <span class="grow"></span>
          <span class="chip chip--soft">${t('app.demo_badge')}</span>
        </div>
      </div>
    </a>`;
}

export const gameGrid = (rows, opts) => html`<div class="grid-games">${(rows || []).map((g) => gameCard(g, opts))}</div>`;

export const skeletonGrid = (n = 8) => html`<div class="grid-games">${Array.from({ length: n }, () => html`<div class="skel skel--card"></div>`)}</div>`;

export function emptyState({ icon: ic = 'chips', titleKey = 'empty.title', bodyKey = 'empty.body', action = '' }) {
  return html`
    <div class="empty">
      <span class="empty__icon">${icon(ic, 30)}</span>
      <h3 style="margin:0">${t(titleKey)}</h3>
      ${bodyKey ? html`<p class="section__sub">${t(bodyKey)}</p>` : ''}
      ${action}
    </div>`;
}

/**
 * Stake control shared by every game: clamps to table limits, keeps a history of
 * quick chips, and reports the final value in integer credits (cents).
 */
export function betPanel(host, { game, stake = 1000, onChange, disabled = false } = {}) {
  const min = game?.minBet || 100;
  const max = game?.maxBet || 1000000;
  let value = clampNum(stake, min, max);
  let pending = null;

  const paint = () => {
    render(host, html`
      <div class="stack" style="--gap:8px">
        <div class="field">
          <label class="field__label" for="stake-input">${t('bet.stake')}</label>
          <div class="input-group">
            <span class="suffix">৳</span>
            <input class="input" id="stake-input" type="number" inputmode="decimal" min="${min / 100}" max="${max / 100}"
              step="1" value="${(value / 100).toFixed(2)}" ${disabled ? 'disabled' : ''} />
            <button class="btn btn--sm" type="button" data-act="half" ${disabled ? 'disabled' : ''}>½</button>
            <button class="btn btn--sm" type="button" data-act="double" ${disabled ? 'disabled' : ''}>2×</button>
            <button class="btn btn--sm" type="button" data-act="max" ${disabled ? 'disabled' : ''}>${t('bet.max')}</button>
          </div>
          <span class="field__hint">${t('bet.limits', { min: fmtCredits(min), max: fmtCredits(max) })}</span>
        </div>
        <div class="row row--wrap" style="gap:6px">
          ${[500, 1000, 2500, 5000, 10000].filter((c) => c >= min && c <= max).map((c) => html`
            <button class="btn-tab" type="button" data-chip="${c}">${fmtCredits(c, { withSymbol: false })}</button>`)}
        </div>
        <div class="field__error" data-role="err" role="alert" aria-live="polite">${pending || ''}</div>
      </div>`);
    const input = host.querySelector('#stake-input');
    input.addEventListener('input', () => { value = clampNum(Math.round((Number(input.value) || 0) * 100), 0, max); emit(); });
    input.addEventListener('blur', () => { value = clampNum(value, min, max); paint(); });
    host.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { value = clampNum(Number(b.dataset.chip), min, max); paint(); }));
    host.querySelector('[data-act=half]')?.addEventListener('click', () => { value = clampNum(Math.floor(value / 2), min, max); paint(); });
    host.querySelector('[data-act=double]')?.addEventListener('click', () => { value = clampNum(value * 2, min, max); paint(); });
    host.querySelector('[data-act=max]')?.addEventListener('click', () => { value = max; paint(); });
    emit();
  };
  const emit = () => onChange?.(value, host.querySelector('[data-role=err]') ? setValueError : setValueError);
  function setValueError(msg) { const n = host.querySelector('[data-role=err]'); if (n) n.textContent = msg || ''; pending = msg || null; }
  paint();
  return {
    get stake() { return value; },
    set: (v) => { value = clampNum(v, min, max); paint(); },
    setError: setValueError,
    refresh: paint,
    disable: (flag = true) => { disabled = flag; paint(); },
  };
}

export function resultPanel(bet, { compact = false } = {}) {
  if (!bet) return '';
  const won = bet.status === 'won' || bet.status === 'cashout';
  const cls = bet.status === 'void' ? 'void' : won ? 'won' : 'lost';
  return html`
    <div class="result-banner result-banner--${cls}" role="status">
      <span>${t(`bet.status.${bet.status}`)}</span>
      ${compact ? '' : html`
        <strong style="font-size:1.2rem">${won ? `+${fmtCredits(bet.payout)}` : `−${fmtCredits(bet.stake)}`}</strong>
        <span class="section__sub">${t('bet.multiplier')} ${fmtMultiplier(bet.multiplier || bet.payout / Math.max(1, bet.stake / 100))} · ${t('bet.stake')} ${fmtCredits(bet.stake)}</span>`}
    </div>`;
}

export const fairLine = (bet) => bet?.fair ? html`
  <div class="row" style="gap:6px;justify-content:center;font-size:.7rem;color:var(--muted)">
    <span class="mono">sha256:${String(bet.fair.hash || '').slice(0, 12)}…</span>
    <span>·</span><span>nonce ${fmtNum(bet.fair.nonce)}</span>
    <a href="/fairness" data-link class="chip chip--soft">${t('fairness.verify')}</a>
  </div>` : '';

export function dataTable({ columns, rows, emptyKey = 'empty.table', dense = false, onRow }) {
  if (!rows?.length) return emptyState({ titleKey: emptyKey, bodyKey: '' });
  return html`
    <div class="table-wrap">
      <table class="data">
        <thead><tr>${columns.map((c) => html`<th class="${c.num ? 'num' : ''}" scope="col">${c.labelKey ? t(c.labelKey) : c.label}</th>`)}</tr></thead>
        <tbody>${rows.map((r, i) => html`
          <tr ${onRow ? `data-row="${r[onRow] ?? i}" tabindex="0"` : ''}>
            ${columns.map((c) => html`<td class="${c.num ? 'num' : ''}">${cellText(c, r)}</td>`)}</tr>`)}
        </tbody>
      </table>
    </div>`;
}

function cellText(c, row) {
  const v = typeof c.get === 'function' ? c.get(row) : row[c.key];
  if (v && v.__raw !== undefined) return v;
  if (c.type === 'money') return fmtCredits(v);
  if (c.type === 'odds') return fmtOdds(v);
  if (c.type === 'mult') return fmtMultiplier(v);
  if (c.type === 'pct') return fmtPercent(v);
  if (c.type === 'date') return fmtDateTime(v);
  if (c.type === 'relative') return fmtRelative(v);
  if (c.type === 'num') return fmtNum(v);
  if (c.type === 'badge') return html`<span class="badge badge--${v}">${t(`bet.status.${v}`, { defaultValue: v })}</span>`;
  if (v === null || v === undefined || v === '') return html`<span style="color:var(--muted)">—</span>`;
  return v;
}

export function kpi({ value, labelKey, delta, tone }) {
  const color = tone === 'red' ? 'var(--red)' : tone === 'green' ? 'var(--green)' : 'var(--gold-light)';
  return html`
    <div class="kpi">
      <div class="kpi__v" style="color:${color}">${value}</div>
      <div class="kpi__k" data-i18n="${labelKey}">${t(labelKey)}</div>
      ${delta !== undefined && delta !== null ? html`<div class="kpi__d">${delta}</div>` : ''}
    </div>`;
}

export const kpiGrid = (items) => html`<div class="kpi-grid">${items.map((i) => kpi(i))}</div>`;

/** Tiny dependency-free bar chart. `series` = [{label, value, value2}] */
export function barChart(series, { labelKey } = {}) {
  const max = Math.max(1, ...series.map((s) => Math.max(s.value || 0, s.value2 || 0)));
  return html`
    <div>
      ${labelKey ? html`<div class="section__sub" style="margin-bottom:6px">${t(labelKey)}</div>` : ''}
      <div class="bars" role="img" aria-label="${t(labelKey || 'chart.activity')}">
        ${series.map((s) => html`
          <div class="bars__col" title="${s.label}: ${fmtNum(s.value)}${s.value2 !== undefined ? ` / ${fmtNum(s.value2)}` : ''}">
            ${s.value2 !== undefined ? html`<div class="bars__bar bars__bar--alt" style="height:${Math.max(2, ((s.value2 || 0) / max) * 100)}px"></div>` : ''}
            <div class="bars__bar" style="height:${Math.max(2, ((s.value || 0) / max) * 100)}px"></div>
            <span class="bars__label">${s.short || s.label}</span>
          </div>`)}
      </div>
    </div>`;
}

export function tabs(list, active, { idPrefix = 'tab' } = {}) {
  return html`
    <div class="tabs" role="tablist">
      ${list.map((x) => html`
        <button class="tab" type="button" role="tab" id="${idPrefix}-t-${x.key}" aria-controls="${idPrefix}-panel"
          aria-selected="${String(x.key === active)}" data-tab="${x.key}">${x.icon ? icon(x.icon, 15) : ''}<span data-i18n="${x.labelKey}">${t(x.labelKey)}</span></button>`)}
    </div>`;
}

export const chipRow = (items, active) => html`
  <div class="row row--wrap filters scroll-x">
    ${items.map((i) => html`<button class="btn-tab" type="button" data-filter="${i.key}" aria-selected="${String(i.key === active)}">${i.icon ? icon(i.icon, 14) : ''} <span data-i18n="${i.labelKey}">${t(i.labelKey)}</span>${i.count !== undefined ? html` (${fmtNum(i.count)})` : ''}</button>`)}
  </div>`;

export const avatarOf = (u) => html`<span class="avatar" aria-hidden="true">${String(u || '?')[0].toUpperCase()}</span>`;

/** Admin-authored rows carry `titleEn`/`titleBn`; never mix the two languages. */
export function bilingual(row, base) {
  const bn = row?.[`${base}Bn`];
  const en = row?.[`${base}En`];
  if (isBengali()) return bn && String(bn).trim() ? bn : en || '';
  return en && String(en).trim() ? en : bn || '';
}

// ---------------------------------------------------------------------------
// Generic table / admin primitives
// ---------------------------------------------------------------------------
const TONES = {
  active: 'ok', live: 'ok', open: 'blue', ok: 'ok', won: 'ok', cashout: 'ok', settled: 'ok',
  answered: 'blue', verified: 'ok', success: 'ok', info: 'blue',
  pending: 'warn', 'in_progress': 'warn', paused: 'warn', suspended: 'warn', bonus: 'warn',
  maintenance: 'warn', warn: 'warn', scheduled: 'blue', new: 'gold',
  lost: 'muted', closed: 'muted', void: 'muted', refunded: 'muted', cancelled: 'muted',
  expired: 'muted', muted: 'muted', error: 'red', danger: 'red', red: 'red',
};
export const toneOf = (status) => TONES[String(status)] || 'soft';

/** Small status/label pill. `labelKey` wins, otherwise `<keyBase><status>` is tried. */
export function chip(text, tone = 'soft', { labelKey = null } = {}) {
  return html`<span class="chip chip--${tone}">${labelKey ? t(labelKey, { defaultValue: text }) : text}</span>`;
}

export function statusPill(status, { keyBase = null } = {}) {
  const s = String(status ?? 'unknown');
  const label = keyBase ? t(`${keyBase}${s}`, { defaultValue: s }) : t(`admin.status_${s}`, { defaultValue: s });
  return html`<span class="chip chip--${toneOf(s)}">${label}</span>`;
}

/** Icon buttons rendered inside a data-table cell. */
export function rowActions(list) {
  return html`<div class="row-actions">${(list || []).map((a) => html`
    <button class="btn btn--sm btn--icon${a.danger ? ' btn--warn' : ''}" type="button" title="${t(a.labelKey, { defaultValue: a.label || a.key })}"
      aria-label="${t(a.labelKey, { defaultValue: a.label || a.key })}" data-action="${a.key}" data-id="${a.id ?? ''}">
      ${icon(a.icon, 15)}</button>`)}</div>`;
}

/** Inline loading row used while a tab fetches. */
export const loadingInline = (labelKey = 'common.loading') => html`
  <div class="row loading-inline"><span class="spinner" aria-hidden="true"></span><span class="section__sub" data-i18n="${labelKey}">${t(labelKey)}</span></div>`;

/** Horizontal section header used across admin tabs. */
export function head({ icon: ic = 'chart', titleKey, subKey, actions = '' }) {
  return html`
    <div class="section__head">
      <div class="grow">
        <h3 class="section__title">${ic ? icon(ic, 16) : ''} <span data-i18n="${titleKey}">${t(titleKey)}</span></h3>
        ${subKey ? html`<p class="section__sub" data-i18n="${subKey}">${t(subKey)}</p>` : ''}
      </div>${actions}
    </div>`;
}

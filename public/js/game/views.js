/**
 * Engine views. Every view gets the GameSession and renders into `session.stage`
 * (the table) and `session.below` (result + meta). Nothing here invents outcomes:
 * all numbers come from the API; the views only animate and collect selections.
 */
import { html, raw, render as paint, icon, on } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtMultiplier, fmtOdds } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshWallet } from '../core/state.js';
import { toast, toastOk, toastError, modal, every } from '../core/ui.js';
import { isLiveConnected } from '../core/sse.js';
import { rouletteColour } from './tables.js';
import { paytable, resultBanner, cardFace, openVerifier } from './session.js';
import { WHEEL_SEGMENTS, ROULETTE_RED, MINES_CELLS, SEG_COLORS } from './tables.js';

const SUIT_ICON = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SYMBOL_ICON = {
  seven: '7️⃣', gold: '🪙', bell: '🔔', lemon: '🍋', cherry: '🍒', wild: '⭐', scatter: '💎',
  bar: '🎏', diamond: '💠', crown: '👑', coin: '🪙', fruit: '🍇', red: '🔴', blue: '🔵', emerald: '🟢',
};
const iconOfSymbol = (k) => SYMBOL_ICON[k] || '🎰';

/** Shared primary control row under the table. */
function controlBar(s, { labelKey = 'btn.spin', extra = '' } = {}) {
  return html`
    <div class="panel"><div class="panel__body row row--wrap" style="gap:10px">
      ${extra}
      <span class="grow"></span>
      <span class="chip chip--soft">${t('bet.stake')}: <b class="mono" data-role="stake-echo">${fmtCredits(s.stake)}</b></span>
      <button class="btn btn--gold btn--lg" type="button" data-role="place">${t(labelKey)}${icon('arrow', 16)}</button>
      ${s.hand ? html`<button class="btn btn--red" type="button" data-role="abandon">${t('btn.abandon')}</button>` : ''}
    </div></div>`;
}
function wirePlace(s, btn, handler) {
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    try { await handler(); } catch { /* toasted inside session */ } finally { btn.disabled = !!s.busy; }
  });
}
const resultHost = (s) => {
  let el = s.below.querySelector('[data-role=result]');
  if (!el) { el = document.createElement('div'); el.dataset.role = 'result'; s.below.append(el); }
  return el;
}
function showResult(s, bet, extra = '') {
  const host = resultHost(s);
  paint(host, resultBanner(bet, { extra }));
  host.querySelector('[data-verify]')?.addEventListener('click', () => openVerifier(host.querySelector('[data-verify]').dataset.verify));
  if (bet?.status === 'won' || bet?.status === 'cashout') s.stage?.classList.add('win-flash');
  setTimeout(() => s.stage?.classList.remove('win-flash'), 900);
}
const spinFx = (el, ms, cls = 'is-spinning') => {
  if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  el.classList.add(cls);
  return new Promise((r) => setTimeout(() => { el.classList.remove(cls); r(); }, ms));
};

// ---------------------------------------------------------------------------
// SLOTS
// ---------------------------------------------------------------------------
export async function slots(s) {
  const cfg = s.game.config || {};
  // The server sends the calibrated paytable (engineDisplayConfig in
  // src/api/game.js). Without it we show nothing rather than invented prizes.
  const scale = Number(cfg.payScale) || 1;
  const symbols = cfg.symbols || [];
  const rows = cfg.rows || 3;
  const reelCount = cfg.reels || 3;
  paint(s.stage, html`
    <div class="stack" style="width:100%">
      <div class="reels" data-role="reels">
        ${Array.from({ length: reelCount }, (_, i) => html`
          <div class="reel" data-reel="${i}"><div class="reel__strip">
            ${Array.from({ length: rows }, () => html`<div class="reel__cell">${iconOfSymbol(symbols[0]?.key || 'seven')}</div>`)}
          </div></div>`)}
      </div>
      <div class="row row--wrap" style="justify-content:center">
        <span class="chip chip--soft">${t('slots.lines', { count: fmtNum(cfg.lines || 5) })}</span>
        ${cfg.freeSpins ? html`<span class="chip chip--gold">${t('slots.free_spins', { count: fmtNum(cfg.freeSpins.spins || 0), mult: fmtMultiplier(cfg.freeSpins.multiplier || 1) })}</span>` : ''}
      </div>
    </div>`);
  paint(s.below, controlBar(s, { labelKey: 'btn.spin' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const reelsHost = s.stage.querySelector('[data-role=reels]');
    const spin = spinFx(reelsHost, 520);
    const out = await s.place({});
    await spin;
    renderGrid(s, out?.bet?.outcome?.grid || out?.outcome?.grid, out?.bet?.outcome?.spins);
    if (out?.bet) showResult(s, out.bet, out.bet.outcome?.freeSpinsAwarded ? html`<span class="chip chip--gold">${t('slots.free_awarded', { count: fmtNum(out.bet.outcome.freeSpinsAwarded) })}</span>` : '');
  });
  function renderGrid(session, grid, spins) {
    if (!grid) return;
    const cells = session.stage.querySelectorAll('.reel');
    grid.forEach((col, x) => {
      const strip = cells[x]?.querySelector('.reel__strip');
      if (!strip) return;
      strip.innerHTML = col.map((k, y) => {
        const winning = (spins?.[0]?.wins || []).some((w) => w.cells?.some(([cx, cy]) => cx === x && cy === y));
        return `<div class="reel__cell${winning ? ' is-win' : ''}" title="${t(`slot.symbol.${k}`, { defaultValue: k })}">${iconOfSymbol(k)}</div>`;
      }).join('');
    });
  }
  // resume last outcome if there is one
  const last = s.history[0];
  if (last?.outcome?.grid) renderGrid(s, last.outcome.grid, last.outcome.spins);
  const box = document.createElement('section');
  box.className = 'panel side-card';
  box.innerHTML = `<div class="panel__head">${icon('info', 16)}<h3>${t('game.paytable')}</h3></div><div class="panel__body paytable"></div>`;
  s.side.append(box);
  paint(box.querySelector('.paytable'), paytable(symbols.map((sy) => [
    html`<span class="row" style="gap:6px">${iconOfSymbol(sy.key)} ${t(`slot.symbol.${sy.key}`, { defaultValue: sy.key })}</span>`,
    html`<span class="mono">${Object.entries(sy.pays || {}).map(([n, p]) => `${n}× → ${fmtMultiplier(Math.round(Number(p) * scale * 1000) / 1000)}`).join(' · ') || '—'}</span>`,
  ])));
  return () => { box.remove(); };
}

// ---------------------------------------------------------------------------
// ROULETTE (also used by the live studio view)
// ---------------------------------------------------------------------------
export function rouletteBoard(onAdd, chips = [100, 500, 1000, 5000]) {
  const reds = new Set(ROULETTE_RED);
  const thirds = [[1, 12], [13, 24], [25, 36]];
  return html`
    <div class="roulette-layout">
      <div class="roulette-board">
        <button class="roulette-cell roulette-cell--zero" type="button" data-bet='{"type":"straight","numbers":[0]}'>0</button>
        ${Array.from({ length: 12 }, (_, col) => {
          const nums = [col * 3 + 1, col * 3 + 2, col * 3 + 3];
          return nums.map((n) => html`
            <button class="roulette-cell ${reds.has(n) ? 'roulette-cell--red' : 'roulette-cell--black'}" type="button"
              data-bet='${JSON.stringify({ type: 'straight', numbers: [n] })}'>${n}</button>`);
        })}
      </div>
      <div class="roulette-extras">
        ${thirds.map(([a, b], i) => html`<button class="roulette-cell roulette-cell--outside" type="button"
          data-bet='${JSON.stringify({ type: 'dozen', value: i + 1 })}'>${t(`roulette.dozen${i + 1}`)}</button>`)}
      </div>
      <div class="roulette-extras" style="grid-template-columns:repeat(6,1fr)">
        <button class="roulette-cell roulette-cell--outside roulette-cell--red" type="button" data-bet='{"type":"red"}'>${t('roulette.red')}</button>
        <button class="roulette-cell roulette-cell--outside roulette-cell--black" type="button" data-bet='{"type":"black"}'>${t('roulette.black')}</button>
        <button class="roulette-cell roulette-cell--outside" type="button" data-bet='{"type":"odd"}'>${t('roulette.odd')}</button>
        <button class="roulette-cell roulette-cell--outside" type="button" data-bet='{"type":"even"}'>${t('roulette.even')}</button>
        <button class="roulette-cell roulette-cell--outside" type="button" data-bet='{"type":"low"}'>1–18</button>
        <button class="roulette-cell roulette-cell--outside" type="button" data-bet='{"type":"high"}'>19–36</button>
      </div>
      <div class="row row--wrap" style="gap:6px;justify-content:center">
        ${chips.map((c, i) => html`<button class="btn btn--sm ${i === 1 ? 'btn--gold' : ''}" type="button" data-chip="${c}">${fmtCredits(c, { withSymbol: false })}</button>`)}
        <button class="btn btn--sm btn--ghost" type="button" data-clear>${t('btn.clear')}</button>
      </div>
    </div>`;
}

export async function roulette(s) {
  let chip = 500;
  const legs = [];
  paint(s.stage, html`
    <div class="stack" style="width:100%">
      <div class="row row--between">
        <div class="recent-numbers" data-role="recent"></div>
        <span class="chip chip--soft" data-role="wheel-hash" title="${t('fairness.server_hash')}">—</span>
      </div>
      <div class="wheel-visual"><div class="wheel-ring" data-role="wheel"><div class="wheel-readout">
        <span class="section__sub">${t('roulette.place_bets')}</span><strong class="wheel-readout__num" data-role="num">—</strong>
      </div></div></div>
      ${rouletteBoard()}
      <div class="list-divided" data-role="legs"></div>
    </div>`);
  paint(s.below, controlBar(s, { labelKey: 'btn.spin_wheel' }));

  const paintLegs = () => {
    const host = s.stage.querySelector('[data-role=legs]');
    const total = legs.reduce((a, l) => a + l.amount, 0);
    if (!legs.length) { paint(host, html`<p class="section__sub">${t('roulette.no_legs')}</p>`); }
    else paint(host, html`
      <div class="row row--between"><strong>${t('roulette.legs', { count: fmtNum(legs.length) })}</strong>
        <span class="mono">${t('bet.stake')}: ${fmtCredits(total)}</span></div>
      ${legs.map((l, i) => html`<div class="row" style="padding:4px 0">
        <span class="grow">${describeLeg(l)}</span><span class="mono">${fmtCredits(l.amount)}</span>
        <button class="btn btn--sm btn--ghost" type="button" data-rm="${i}" aria-label="${t('btn.remove')}">${icon('close', 13)}</button></div>`)}`);
    s.stake = total;
    s.controls?.set(total);
    const echo = s.below.querySelector('[data-role=stake-echo]');
    if (echo) echo.textContent = fmtCredits(total);
  };
  paintLegs();

  on(s.stage, 'click', '[data-chip]', (ev, b) => { chip = Number(b.dataset.chip); s.stage.querySelectorAll('[data-chip]').forEach((x) => x.classList.toggle('btn--gold', x === b)); });
  on(s.stage, 'click', '[data-bet]', (ev, b) => {
    const parsed = JSON.parse(b.dataset.bet);
    legs.push({ ...parsed, amount: chip });
    paintLegs();
  });
  on(s.stage, 'click', '[data-rm]', (ev, b) => { legs.splice(Number(b.dataset.rm), 1); paintLegs(); });
  on(s.stage, 'click', '[data-clear]', () => { legs.length = 0; paintLegs(); });

  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    if (!legs.length) { toast(t('roulette.pick_leg')); s.setError(t('roulette.pick_leg')); return; }
    const out = await s.place({ bets: legs.map(({ type, numbers, value, amount }) => ({ type, numbers, value, amount })) });
    const number = out?.bet?.outcome?.number;
    const wheel = s.stage.querySelector('[data-role=wheel]');
    await spinFx(wheel, 1100);
    if (number !== undefined && number !== null) {
      const info = out.bet.outcome.info || {};
      const numEl = s.stage.querySelector('[data-role=num]');
      numEl.textContent = number;
      numEl.style.color = info.color === 'red' ? 'var(--red)' : info.color === 'green' ? 'var(--green)' : '';
      const recent = s.stage.querySelector('[data-role=recent]');
      recent.insertAdjacentHTML('afterbegin', `<span class="num-pill num-pill--${info.color || 'black'}">${number}</span>`);
      while (recent.children.length > 10) recent.lastElementChild.remove();
    }
    s.stage.querySelector('[data-role=wheel-hash]').textContent = `${t('roulette.result')}: ${fmtMultiplier(out?.bet?.multiplier || 0)}`;
    if (out?.bet) showResult(s, out.bet, legTable(out.bet.outcome?.legs));
    legs.length = 0;
    paintLegs();
  });

  if (s.history[0]?.outcome?.number !== undefined) {
    const r = s.stage.querySelector('[data-role=recent]');
    r.innerHTML = s.history.filter((b) => b.outcome?.number !== undefined).slice(0, 10)
      .map((b) => `<span class="num-pill num-pill--${b.outcome?.info?.color || 'black'}">${b.outcome.number}</span>`).join('');
  }
  return () => {};
}
const legTable = (legs) => legs?.length ? html`
  <div class="paytable" style="margin-top:8px">
    ${legs.map((l) => html`<div><span>${describeLeg(l)}</span><b class="${l.won ? 'chip--green' : ''}">${l.won ? `+${fmtCredits(l.payout)}` : t('bet.status.lost')}</b></div>`)}
  </div>` : '';

export function describeLeg(leg) {
  const nums = (leg.numbers || []).join(', ');
  const map = {
    straight: 'roulette.straight', split: 'roulette.split', street: 'roulette.street', corner: 'roulette.corner',
    sixline: 'roulette.sixline', red: 'roulette.red', black: 'roulette.black', odd: 'roulette.odd', even: 'roulette.even',
    low: 'roulette.low', high: 'roulette.high', dozen: 'roulette.dozen', column: 'roulette.column',
  };
  const base = t(map[leg.type] || leg.type);
  if (leg.type === 'dozen') return `${base} ${leg.value}`;
  if (leg.type === 'column') return `${base} ${leg.value}`;
  return nums ? `${base} (${nums})` : base;
}

// ---------------------------------------------------------------------------
// DICE
// ---------------------------------------------------------------------------
export async function dice(s) {
  let mode = 'under';
  let target = 50;
  const edge = (s.game.houseEdgeBps || 100) / 10000;
  const multFor = (m, t) => {
    const chance = m === 'under' ? t : m === 'over' ? 99 - t : 1;
    return chance > 0 ? (1 - edge) / chance : 0;
  };
  const paint_ = () => {
    const mult = multFor(mode, target);
    paint(s.stage, html`
      <div class="stack" style="width:min(520px,100%)">
        <div class="row row--wrap" style="justify-content:center">
          ${['under', 'over', 'equal'].map((m) => html`<button class="btn-tab" type="button" data-mode="${m}" aria-selected="${String(m === mode)}">${t(`dice.${m}`)}</button>`)}
        </div>
        <div class="dice-track"><span class="dice-marker" data-role="marker" style="left:${target}%">${target}</span></div>
        <input class="dice-slider" type="range" min="2" max="98" step="1" value="${target}" data-role="target"
          aria-label="${t('dice.target')}" ${mode === 'equal' ? 'disabled' : ''} />
        <div class="dice-scale"><span>2</span><span>50</span><span>98</span></div>
        <dl class="kv">
          <dt>${t('dice.multiplier')}</dt><dd>${fmtMultiplier(mult)}</dd>
          <dt>${t('dice.win_chance')}</dt><dd>${fmtNum((mode === 'under' ? target : mode === 'over' ? 99 - target : 1), { max: 0 })}%</dd>
          <dt>${t('dice.payout')}</dt><dd>${fmtCredits(Math.floor(s.stake * mult))}</dd>
          <dt>${t('dice.result')}</dt><dd class="mono" data-role="roll">—</dd>
        </dl>
      </div>`);
    s.stage.querySelector('[data-role=target]')?.addEventListener('input', (ev) => { target = Number(ev.target.value); paint_(); });
    s.stage.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; if (mode === 'equal') target = 7; paint_(); }));
  };
  paint_();
  paint(s.below, controlBar(s, { labelKey: 'btn.roll' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const out = await s.place({ mode, target });
    const roll = out?.bet?.outcome?.roll;
    const marker = s.stage.querySelector('[data-role=marker]');
    if (roll !== undefined) {
      marker.style.left = `${Math.min(98, Math.max(2, roll))}%`;
      marker.textContent = roll;
      s.stage.querySelector('[data-role=roll]').textContent = String(roll);
    }
    if (out?.bet) showResult(s, out.bet);
    paint_();
  });
  return () => {};
}

// ---------------------------------------------------------------------------
// MINES (multi-step)
// ---------------------------------------------------------------------------
export async function mines(s) {
  let minesCount = s.game.config?.mines ?? 3;
  const cells = MINES_CELLS || 25;
  const view = s.hand?.view || null;
  const paint_ = () => {
    const revealed = view?.revealed || [];
    const hit = view?.hit;
    const bombs = view?.mines || [];
    const playing = !!s.hand;
    paint(s.stage, html`
      <div class="stack" style="align-items:center;width:100%">
        ${!playing ? html`
          <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center">
            <span class="section__sub">${t('mines.count')}</span>
            ${[1, 3, 5, 7, 10].map((n) => html`<button class="btn-tab" type="button" data-mines="${n}" aria-selected="${String(n === minesCount)}">${fmtNum(n)}</button>`)}
          </div>` : ''}
        <div class="mines-grid" data-role="grid">
          ${Array.from({ length: cells }, (_, i) => {
            const isRevealed = revealed.includes(i);
            const isBomb = playing && (hit === i || (view?.cashedOut || hit !== undefined) && bombs.includes(i));
            return html`<button class="mine-cell ${isRevealed ? 'mine-cell--gem' : ''}${isBomb ? ' mine-cell--bomb' : ''}" type="button"
              data-cell="${i}" ${!playing || isRevealed ? 'disabled' : ''} aria-label="${t('mines.cell', { n: fmtNum(i + 1) })}">
              ${isRevealed ? '💎' : isBomb ? '💣' : ''}</button>`;
          })}
        </div>
        ${playing ? html`
          <div class="row" style="gap:14px;justify-content:center;width:100%">
            <div class="mines-meter grow"><span class="section__sub">${t('mines.next')}</span>
              <div class="meter"><span style="width:${Math.min(100, (revealed.length / (cells - minesCount)) * 100)}%"></span></div></div>
            <div><div class="stat__v">${fmtMultiplier(view?.multiplier || 1)}</div><div class="stat__k">${t('bet.multiplier')}</div></div>
            <div><div class="stat__v">${fmtCredits(Math.floor((s.hand?.stake || s.stake) * (view?.multiplier || 1)))}</div><div class="stat__k">${t('mines.current_payout')}</div></div>
          </div>` : ''}
      </div>`);
    s.stage.querySelectorAll('[data-mines]').forEach((b) => b.addEventListener('click', () => { minesCount = Number(b.dataset.mines); paint_(); }));
    s.stage.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', async () => {
      if (!s.hand) return;
      const out = await s.act('pick', { cell: Number(b.dataset.cell) });
      applyHand(s, out, paint_);
    }));
    paint(s.below, controlBar(s, { labelKey: s.hand ? 'btn.cashout' : 'btn.start_mines' }));
    const place = s.below.querySelector('[data-role=place]');
    place.addEventListener('click', async () => {
      if (s.hand) { const out = await s.act('cashout'); applyHand(s, out, paint_); }
      else { const out = await s.place({ mines: minesCount }); applyHand(s, out, paint_); if (!s.hand && out?.bet) showResult(s, out.bet); }
    });
    s.below.querySelector('[data-role=abandon]')?.addEventListener('click', async () => { await s.abandon(); paint_(); });
  };
  paint_();
  return () => {};
}

function applyHand(s, out, after) {
  if (!out) return;
  if (out.bet) {
    s.hand = out.pending ? { ...(out.bet || {}), view: out.view, actions: out.actions || [] } : null;
    if (!out.pending && out.bet) showResult(s, out.bet);
  }
  after?.();
  s.onChange(s);
}

// ---------------------------------------------------------------------------
// WHEEL
// ---------------------------------------------------------------------------
export async function wheel(s) {
  let target = 2;
  const segs = WHEEL_SEGMENTS || 20;
  const colors = SEG_COLORS || ['#e3b341', '#142449', '#b5303c', '#17864f'];
  const paint_ = (activeSeg = null, won = null) => {
    const radius = 92;
    const paths = Array.from({ length: segs }, (_, i) => {
      const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
      const x0 = 100 + radius * Math.cos(a0), y0 = 100 + radius * Math.sin(a0);
      const x1 = 100 + radius * Math.cos(a1), y1 = 100 + radius * Math.sin(a1);
      return `<path class="seg" data-seg="${i}" d="M100,100 L${x0.toFixed(1)},${y0.toFixed(1)} A${radius},${radius} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z"
        fill="${colors[i % colors.length]}" opacity="${activeSeg === null ? 1 : activeSeg === i ? 1 : 0.35}"
        ${activeSeg === i ? 'stroke="#f7dd9a" stroke-width="3"' : ''} />`;
    }).join('');
    paint(s.stage, html`
      <div class="wheel-wrap" style="width:100%">
        <div class="row row--wrap" style="justify-content:center">
          ${[1.2, 1.5, 2, 3, 5, 10, 20, 50].map((m) => html`<button class="btn-tab" type="button" data-target="${m}" aria-selected="${String(m === target)}">${fmtMultiplier(m)}</button>`)}
        </div>
        <div class="wheel-pointer" aria-hidden="true">▼</div>
        <svg class="wheel-svg" viewBox="0 0 200 200" role="img" aria-label="${t('wheel.title')}">${raw(paths)}</svg>
        <dl class="kv" style="width:min(340px,100%)">
          <dt>${t('wheel.target')}</dt><dd>${fmtMultiplier(target)}</dd>
          <dt>${t('wheel.winning_segments')}</dt><dd>${winSegText(s, target)} / ${segs}</dd>
          <dt>${t('dice.payout')}</dt><dd>${fmtCredits(Math.floor(s.stake * target))}</dd>
          <dt>${t('wheel.result')}</dt><dd class="mono">${activeSeg === null ? '—' : won ? t('wheel.hit') : t('wheel.miss')}</dd>
        </dl>
      </div>`);
    s.stage.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => { target = Number(b.dataset.target); paint_(); }));
  };
  paint_();
  paint(s.below, controlBar(s, { labelKey: 'btn.spin_wheel' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const out = await s.place({ target });
    const seg = out?.bet?.outcome?.segment;
    await new Promise((r) => setTimeout(r, 400));
    paint_(seg, out?.bet?.outcome?.hit);
    if (out?.bet) showResult(s, out.bet);
  });
  return () => {};
}
function winSegText(s, target) {
  // Mirrors wheel.init() in src/games/table.js: each visible slice is split into
  // sub-slots, because a 20-slice wheel cannot express 1.2x or 50x honestly.
  const edge = Math.max(0, Math.min(0.2, (s.game.houseEdgeBps ?? 400) / 10000));
  const segs = WHEEL_SEGMENTS || 20;
  const sub = Math.max(20, Math.ceil(target) * 10);
  const total = segs * sub;
  const winning = Math.max(1, Math.min(total - 1, Math.floor((total * (1 - edge)) / target)));
  return fmtNum(Math.round((winning / sub) * 100) / 100);
}

// ---------------------------------------------------------------------------
// PLINKO
// ---------------------------------------------------------------------------
export async function plinko(s) {
  // The bucket multipliers come from the game config the server publishes, so the
  // board cannot show a table the engine does not pay, and switching risk actually
  // changes what is drawn.
  const cfg = s.game.config || {};
  const tables = cfg.tables || {};
  let risk = 'medium';
  const paint_ = (path = null, bucket = null) => {
    const table = tables[risk] || [];
    const rows = cfg.rows || 12;
    const pegs = [];
    for (let r = 0; r < rows; r += 1) {
      const count = r + 3;
      for (let i = 0; i < count; i += 1) pegs.push(`<circle cx="${100 + (i - (count - 1) / 2) * (160 / (rows + 2))}" cy="${20 + r * 11}" r="1.6" fill="#3a4a72"/>`);
    }
    const pts = [[100, 14]];
    if (path) path.forEach((dir, i) => { pts.push([pts[i][0] + (dir ? 1 : -1) * (i + 3) * (6.6), 20 + (i + 1) * 11]); });
    const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    paint(s.stage, html`
      <div class="plinko-wrap stack" style="align-items:center">
        <div class="row row--wrap" style="justify-content:center">
          ${['low', 'medium', 'high'].map((r) => html`<button class="btn-tab" type="button" data-risk="${r}" aria-selected="${String(r === risk)}">${t(`plinko.${r}`)}</button>`)}
        </div>
        <svg class="plinko-board" viewBox="0 0 200 160" role="img" aria-label="${t('plinko.title')}">
          ${raw(pegs.join(''))}
          ${path ? `<polyline points="${poly}" fill="none" stroke="#f7dd9a" stroke-width="1.4" stroke-linejoin="round"/>
            <circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="3.4" fill="#e3b341"/>` : ''}
        </svg>
        <div class="plinko-buckets" style="width:100%">
          ${table.map((m, i) => html`<div class="${bucket === i ? 'is-hit' : ''}">${fmtNum(m, { max: 1 })}×</div>`)}
        </div>
      </div>`);
    s.stage.querySelectorAll('[data-risk]').forEach((b) => b.addEventListener('click', () => { risk = b.dataset.risk; paint_(); }));
  };
  paint_();
  paint(s.below, controlBar(s, { labelKey: 'btn.drop' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const out = await s.place({ risk });
    paint_(out?.bet?.outcome?.path || null, out?.bet?.outcome?.bucket ?? null);
    if (out?.bet) showResult(s, out.bet);
  });
  return () => {};
}

// ---------------------------------------------------------------------------
// BINGO
// ---------------------------------------------------------------------------
export async function bingo(s) {
  const paint_ = (outcome = null) => {
    const card = outcome?.card || [null, null, null, null, 0, null, null, null, null];
    const drawn = outcome?.drawn || [];
    const matched = (i) => card[i] === 0 || drawn.includes(card[i]);
    paint(s.stage, html`
      <div class="stack" style="align-items:center;width:100%">
        <div class="bingo-card">
          ${card.map((n, i) => html`<div class="bingo-cell ${n === 0 ? 'bingo-cell--free' : ''}${matched(i) && n !== 0 ? ' is-called' : ''}">${n === 0 ? t('bingo.free') : fmtNum(n)}</div>`)}
        </div>
        <div class="bingo-balls" style="justify-content:center">
          ${drawn.slice(0, 12).map((b) => html`<span class="ball">${fmtNum(b)}</span>`)}
        </div>
        <div class="row row--wrap" style="justify-content:center">
          <span class="chip chip--soft">${t('bingo.balls', { count: fmtNum(drawn.length) })}</span>
          <span class="chip ${outcome?.pattern !== 'none' ? 'chip--green' : ''}">${t(`bingo.pattern.${outcome?.pattern || 'none'}`)}</span>
        </div>
      </div>`);
  };
  paint_();
  paint(s.below, controlBar(s, { labelKey: 'btn.draw' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const out = await s.place({});
    paint_(out?.bet?.outcome);
    if (out?.bet) showResult(s, out.bet);
  });
  return () => {};
}

// ---------------------------------------------------------------------------
// BLACKJACK (multi-step)
// ---------------------------------------------------------------------------
export async function blackjack(s) {
  const paint_ = () => {
    const v = s.hand?.view || s.lastBet?.view || {};
    const hands = v.hands || (v.player ? [{ cards: v.player, total: v.playerTotal, bet: s.lastBet?.stake || s.stake }] : []);
    const dealerCards = v.dealer || [];
    const showDealerTotal = v.dealerHidden ? null : (v.dealerTotal ?? null);
    const actions = s.hand?.actions || [];
    paint(s.stage, html`
      <div class="stack" style="width:100%;align-items:center">
        <div class="hand-bar" style="width:min(560px,100%)">
          <span class="section__sub">${t('bj.dealer')}</span>
          <span class="grow"></span>
          ${showDealerTotal !== null ? html`<span class="total-badge">${fmtNum(showDealerTotal)}</span>` : ''}
        </div>
        <div class="cards-row">${dealerCards.map((c) => cardFace(c)).join('') ? raw(dealerCards.map((c) => cardFace(c)).join('')) : ''}
          ${v.dealerHidden ? raw('<span class="play-card play-card--hidden" aria-hidden="true"></span>') : ''}</div>
        <hr style="width:min(560px,100%)" />
        ${hands.length ? hands.map((h, i) => html`
          <div class="hand-bar" style="width:min(560px,100%)">
            <span class="section__sub">${hands.length > 1 ? `${t('bj.hand')} ${i + 1}` : t('bj.you')} · ${fmtCredits(h.bet || 0)}</span>
            <span class="grow"></span>
            <span class="total-badge ${h.total > 21 ? 'total-badge--bust' : h.total === 21 ? 'total-badge--win' : ''}">${fmtNum(h.total || 0)}</span>
          </div>
          <div class="cards-row">${raw((h.cards || []).map((c) => cardFace(c)).join(''))}</div>
          ${h.result ? html`<span class="chip chip--${h.result === 'win' ? 'green' : h.result === 'push' ? 'soft' : 'red'}">${t(`bj.result.${h.result}`)}</span>` : ''}`) : html`
          <div class="empty" style="padding:20px">
            <span class="empty__icon">🂠</span>
            <p class="section__sub">${t('bj.deal_hint')}</p>
          </div>`}
        ${v.messageKey ? html`<span class="chip chip--soft">${t(v.messageKey)}</span>` : ''}
      </div>`);
    paint(s.below, html`
      ${s.hand ? html`
        <div class="panel"><div class="panel__body row row--wrap" style="gap:8px">
          ${actions.includes('hit') ? html`<button class="btn btn--green" type="button" data-act="hit">${t('btn.hit')}</button>` : ''}
          ${actions.includes('stand') ? html`<button class="btn" type="button" data-act="stand">${t('btn.stand')}</button>` : ''}
          ${actions.includes('double') ? html`<button class="btn btn--gold" type="button" data-act="double">${t('btn.double')}</button>` : ''}
          ${actions.includes('split') ? html`<button class="btn" type="button" data-act="split">${t('btn.split')}</button>` : ''}
          <span class="grow"></span>
          <button class="btn btn--red btn--sm" type="button" data-act="abandon">${t('btn.abandon')}</button>
        </div></div>`
      : controlBar(s, { labelKey: 'btn.deal' })}`);
    const host = s.below;
    host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === 'abandon') { await s.abandon(); }
        else { const out = await s.act(act); applyHand(s, out, paint_); }
        paint_();
      } catch { /* toasted */ } finally { b.disabled = false; }
    }));
    wirePlace(s, host.querySelector('[data-role=place]'), async () => {
      const out = await s.place({});
      applyHand(s, out, paint_);
      if (out?.bet && !out.pending) showResult(s, out.bet);
      else paint_();
    });
  };
  paint_();
  return () => {};
}

// ---------------------------------------------------------------------------
// VIDEO POKER (multi-step)
// ---------------------------------------------------------------------------
export async function videoPoker(s) {
  const held = new Set();
  const VP_PAY = { royal_flush: 250, straight_flush: 50, four: 25, full_house: 9, flush: 6, straight: 4, three: 3, two_pair: 2, pair: 1 };
  const paint_ = (view = s.hand?.view || s.lastBet?.view || null) => {
    const cards = view?.cards || [];
    paint(s.stage, html`
      <div class="stack" style="align-items:center;width:100%">
        <div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center">
          ${cards.map((c, i) => html`
            <button class="col" type="button" data-hold-i="${i}" aria-pressed="${String(held.has(i))}" style="border:0;background:none;cursor:pointer;gap:4px">
              ${raw(cardFace(c))}
              <span class="chip ${held.has(i) ? 'chip--gold' : 'chip--soft'}">${held.has(i) ? t('vp.hold') : t('vp.discard')}</span>
            </button>`)}
        </div>
        ${!cards.length ? html`<div class="empty"><span class="empty__icon">🂡</span><p class="section__sub">${t('vp.deal_hint')}</p></div>` : ''}
        ${view?.hand ? html`<div class="result-banner result-banner--won"><span>${t('vp.made')}</span><strong>${t(`vp.hand.${view.handKey || view.hand}`, { defaultValue: view.hand })}</strong></div>` : ''}
        <div class="row row--wrap" style="justify-content:center">
          <button class="btn ${s.hand ? 'btn--gold' : 'btn--gold'} btn--lg" type="button" data-role="main">${s.hand ? t('btn.draw') : t('btn.deal')}</button>
          ${s.hand ? html`<button class="btn btn--red" type="button" data-role="abandon">${t('btn.abandon')}</button>` : ''}
        </div>
      </div>`);
    s.stage.querySelectorAll('[data-hold-i]').forEach((b) => b.addEventListener('click', () => {
      if (!s.hand) { toast(t('vp.hold_after_deal')); return; }
      const i = Number(b.dataset.holdI);
      if (held.has(i)) held.delete(i); else held.add(i);
      paint_(s.hand?.view);
    }));
    const main = s.stage.querySelector('[data-role=main]');
    main?.addEventListener('click', async () => {
      if (s.hand) { const out = await s.act('draw', { held: [...held] }); held.clear(); applyHand(s, out, paint_); if (out?.bet) showResult(s, out.bet); }
      else { const out = await s.place({}); applyHand(s, out, paint_); }
    });
    s.stage.querySelector('[data-role=abandon]')?.addEventListener('click', async () => { await s.abandon(); held.clear(); paint_(); });
    paint(s.below, '');
  };
  paint_();
  const box = document.createElement('section');
  box.className = 'panel side-card';
  box.innerHTML = `<div class="panel__head">${icon('info', 16)}<h3>${t('game.paytable')}</h3></div><div class="panel__body paytable"></div>`;
  s.side.append(box);
  paint(box.querySelector('.paytable'), paytable(Object.entries(VP_PAY).map(([k, v]) => [t(`vp.hand.${k}`, { defaultValue: k }), `${v}:1`])));
  return () => { box.remove(); };
}

// ---------------------------------------------------------------------------
// BACCARAT / THREE PATTI — side-bet boards
// ---------------------------------------------------------------------------
const SIDES = {
  baccarat: [
    { side: 'player', labelKey: 'bacc.player' },
    { side: 'banker', labelKey: 'bacc.banker' },
    { side: 'tie', labelKey: 'bacc.tie' },
    { side: 'pair_player', labelKey: 'bacc.pair_player' },
    { side: 'pair_banker', labelKey: 'bacc.pair_banker' },
  ],
  three_patti: [
    { side: 'player', labelKey: 'patti.player' },
    { side: 'pair_plus', labelKey: 'patti.pair_plus' },
  ],
};

/**
 * Chips are labelled from the pay map the server publishes with the game, so the
 * number on the button is the number the engine pays. Odds are shown as profit
   ("n:1"), the engine stores the total return, so 2 means 1:1 and 1.95 means
 * 0.95:1. A tiered side such as Pair Plus is shown as its range.
 */
function oddsLabel(pays) {
  if (pays === null || pays === undefined) return null;
  if (typeof pays === 'number') {
    const profit = Math.round((pays - 1) * 100) / 100;
    return `${fmtMultiplier(profit)}:1`;
  }
  const values = Object.values(pays).map(Number).filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  const top = Math.max(...values);
  const low = Math.min(...values);
  if (top === low) return `${fmtMultiplier(top - 1)}:1`;
  return `${fmtMultiplier(low - 1 > 0 ? low - 1 : 0)}:1-${fmtMultiplier(top - 1)}:1`;
}
export function sideBetGame(engine) {
  return async function view(s) {
    const cfg = s.game.config || {};
    const all = SIDES[engine] || SIDES.baccarat;
    // The server decides which sides exist at all: a bet type the engine refuses
    // must not be offered as a chip, even in demo mode.
    const allowed = Array.isArray(cfg.sides) && cfg.sides.length ? cfg.sides : null;
    const sides = all
      .filter((sd) => !allowed || allowed.includes(sd.side))
      .map((sd) => ({ ...sd, pay: oddsLabel(cfg.odds && cfg.odds[sd.side]) ?? '—' }));
    const legs = [];
    let chip = 500;
    const paint_ = (outcome = null) => {
      paint(s.stage, html`
        <div class="stack" style="width:100%;align-items:center">
          <div class="grid-2" style="width:min(520px,100%)">
            ${(outcome?.player || outcome?.banker) ? html`
              <div class="panel panel--flat"><div class="panel__body center">
                <div class="section__sub">${t(engine === 'baccarat' ? 'bacc.player' : 'patti.player')}</div>
                <div class="cards-row" style="justify-content:center">${raw((outcome.player || []).map((c) => cardFace(c)).join(''))}</div>
                ${outcome.playerTotal !== undefined ? html`<span class="total-badge">${fmtNum(outcome.playerTotal)}</span>` : ''}
                ${outcome.playerRank ? html`<div class="chip chip--soft">${outcome.playerRank}</div>` : ''}
              </div></div>
              <div class="panel panel--flat"><div class="panel__body center">
                <div class="section__sub">${t(engine === 'baccarat' ? 'bacc.banker' : 'patti.dealer')}</div>
                <div class="cards-row" style="justify-content:center">${raw((outcome.banker || outcome.dealer || []).map((c) => cardFace(c)).join(''))}</div>
                ${outcome.bankerTotal !== undefined ? html`<span class="total-badge">${fmtNum(outcome.bankerTotal)}</span>` : ''}
                ${outcome.dealerRank ? html`<div class="chip chip--soft">${outcome.dealerRank}</div>` : ''}
              </div></div>` : html`
              <div class="empty" style="grid-column:1/-1"><span class="empty__icon">🎴</span><p class="section__sub">${t('bacc.place_hint')}</p></div>`}
          </div>
          <div class="grid-3" style="width:min(560px,100%)">
            ${sides.map((sd) => html`
              <button class="card" type="button" data-side="${sd.side}" style="padding:12px;text-align:center">
                <div class="card__title" data-i18n="${sd.labelKey}">${t(sd.labelKey)}</div>
                <div class="card__meta" style="justify-content:center"><span class="mono">${sd.pay}</span></div>
                <div class="chip chip--soft">${fmtCredits(chip)}</div>
              </button>`)}
          </div>
          <div class="row row--wrap" style="gap:6px;justify-content:center">
            ${[100, 500, 1000, 5000].map((c) => html`<button class="btn btn--sm ${c === chip ? 'btn--gold' : ''}" type="button" data-chip="${c}">${fmtCredits(c, { withSymbol: false })}</button>`)}
            <button class="btn btn--sm btn--ghost" type="button" data-clear>${t('btn.clear')}</button>
          </div>
          ${legs.length ? html`<div class="paytable">${legs.map((l, i) => html`
            <div><span>${t(sides.find((x) => x.side === l.side)?.labelKey || l.side)}
              ${outcome?.legs?.[i]?.won ? html`<span class="chip chip--green">${t('bet.status.won')}</span>` : outcome?.legs ? html`<span class="chip chip--red">${t('bet.status.lost')}</span>` : ''}</span>
              <b class="row" style="gap:6px"><span class="mono">${fmtCredits(l.amount)}</span>
              <button class="btn btn--sm btn--ghost" type="button" data-rm="${i}" aria-label="${t('btn.remove')}">${icon('close', 12)}</button></b></div>`)}</div>` : ''}
        </div>`);
      s.stage.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { legs.push({ side: b.dataset.side, amount: chip }); paint_(); }));
      s.stage.querySelectorAll('[data-chip]').forEach((b) => b.addEventListener('click', () => { chip = Number(b.dataset.chip); paint_(); }));
      s.stage.querySelector('[data-clear]')?.addEventListener('click', () => { legs.length = 0; paint_(); });
      on(s.stage, 'click', '[data-rm]', (ev, b) => { legs.splice(Number(b.dataset.rm), 1); paint_(); });
      paint(s.below, controlBar(s, { labelKey: 'btn.deal' }));
      const total = legs.reduce((a, l) => a + l.amount, 0);
      if (total) { s.stake = total; s.controls?.set(total); const echo = s.below.querySelector('[data-role=stake-echo]'); if (echo) echo.textContent = fmtCredits(total); }
      wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
        if (!legs.length) { toast(t('bacc.pick_side')); return; }
        const out = await s.place({ bets: legs.map((l) => ({ side: l.side, amount: l.amount })) });
        paint_(out?.bet?.outcome);
        if (out?.bet) showResult(s, out.bet);
        legs.length = 0;
        paint_();
      });
    };
    paint_(s.history[0]?.outcome);
    return () => {};
  };
}

// ---------------------------------------------------------------------------
// CRASH (round based, live)
// ---------------------------------------------------------------------------
export async function crash(s) {
  let auto = 2;
  let st = null;
  let myBet = null;
  const history = state.content?.crash?.history || [];
  let pts = [];
  const paint_ = () => {
    const status = st?.status || 'idle';
    const mult = st?.multiplier || 1;
    const endsAt = st?.phaseEndsAt;
    const players = (st?.participants || []).slice(0, 12);
    const secsLeft = endsAt ? Math.max(0, (Date.parse(String(endsAt).replace(' ', 'T') + (String(endsAt).endsWith('Z') ? '' : 'Z')) - Date.now()) / 1000)
      : endsAt && Number.isFinite(Number(endsAt)) ? Math.max(0, (Number(endsAt) - Date.now()) / 1000) : null;
    paint(s.stage, html`
      <div class="crash-stage" data-role="crash-stage" style="width:100%">
        <canvas class="crash-canvas" data-role="curve" width="800" height="320" aria-hidden="true"></canvas>
        <div class="crash-readout">
          <span class="chip chip--soft">${t(`crash.phase.${status}`)}</span>
          <span class="crash-mult ${status === 'crashed' ? 'crash-mult--crashed' : status === 'flying' ? 'crash-mult--live' : ''}">${fmtMultiplier(mult)}</span>
          <span class="crash-sub">${status === 'betting' && secsLeft !== null ? t('crash.betting_in', { time: `${fmtNum(Math.floor(secsLeft))}s` })
            : status === 'crashed' ? t('crash.crashed_at', { value: fmtMultiplier(st?.crashPoint || mult) })
            : status === 'flying' ? t('crash.flying') : t('crash.idle')}</span>
          <span class="crash-hash mono">${st?.serverSeedHash ? `sha256 ${String(st.serverSeedHash).slice(0, 20)}…` : ''}</span>
        </div>
      </div>
      <div class="grid-2" style="width:100%">
        <section class="panel"><div class="panel__body stack">
          <div class="field">
            <label class="field__label" for="crash-auto">${t('crash.auto_cashout')}</label>
            <div class="input-group"><input class="input" id="crash-auto" type="number" min="1.01" max="1000" step="0.01" value="${auto}" />
              <span class="suffix">×</span>
              <button class="btn btn--sm" type="button" data-act="auto-off" aria-pressed="${String(!auto)}">${auto ? t('btn.on') : t('btn.off')}</button></div>
            <span class="field__hint">${t('crash.auto_hint')}</span>
          </div>
          <div class="row" style="gap:8px">
            <button class="btn btn--gold btn--block btn--lg" type="button" data-role="join">${myBet ? t('crash.queued_join') : t('btn.place_bet')}</button>
            ${myBet && status === 'flying' ? html`<button class="btn btn--green btn--block btn--lg" type="button" data-role="cashout">${t('btn.cash_out')} (${fmtCredits(Math.floor((myBet.stake || s.stake) * mult))})</button>` : ''}
            ${myBet && status === 'betting' ? html`<button class="btn btn--red" type="button" data-role="cancel">${t('btn.cancel')}</button>` : ''}
          </div>
          ${s.hand || myBet ? html`<div class="row" style="gap:8px;justify-content:center">
            <span class="chip chip--soft">${t('crash.my_bet')}: ${fmtCredits(myBet?.stake || s.hand?.stake || 0)}</span>
            <span class="chip chip--blue">${t('crash.round')}: ${st?.roundId || '—'}</span></div>` : ''}
        </div></section>
        <section class="panel"><div class="panel__head">${icon('live', 16)}<h3>${t('crash.players', { count: fmtNum(st?.participantCount || 0) })}</h3>
          <span class="grow"></span><span class="chip chip--soft">${t('crash.total_staked')} ${fmtCredits(st?.totalStaked || 0)}</span></div>
          <div class="panel__body panel__body--tight">
            <div class="crash-players" data-role="players">
              ${players.length ? players.map((p) => html`
                <div class="crash-row ${p.userId !== undefined ? 'crash-row--me' : ''}">
                  <span class="mono" style="font-size:.78rem">${p.masked}</span>
                  <span class="mono">${fmtCredits(p.stake)}</span>
                  <span class="chip ${p.cashedAt ? 'chip--green' : 'chip--soft'}">${p.cashedAt ? `${fmtMultiplier(p.cashedAt)} · ${fmtCredits(p.payout || 0)}` : t('crash.in_flight')}</span>
                </div>`) : html`<p class="section__sub">${t('crash.no_players')}</p>`}
            </div>
          </div></section>
      </div>
      <div class="row row--wrap" style="width:100%;justify-content:space-between">
        <div class="crash-history">${history.map((h) => html`<b data-tier="${h.multiplier >= 5 ? 'high' : h.multiplier >= 2 ? 'mid' : 'low'}">${fmtMultiplier(h.multiplier)}</b>`)}</div>
        <button class="btn btn--sm btn--ghost" type="button" data-role="verify-round">${t('fairness.verify_round')}</button>
      </div>`);

    draw(pts);
    s.stage.querySelector('#crash-auto')?.addEventListener('input', (ev) => { auto = Number(ev.target.value) || 0; });
    s.stage.querySelector('[data-act=auto-off]')?.addEventListener('click', (ev) => { auto = auto ? 0 : 2; paint_(); ev.currentTarget.blur(); });
    s.stage.querySelector('[data-role=join]')?.addEventListener('click', async () => {
      const out = await s.place({ autoCashout: auto > 1 ? auto : null }, { silent: true });
      if (out) { myBet = out.bet; st = out.state || st; toastOk(t(out.queued ? 'crash.queued' : 'crash.joined')); paint_(); }
    });
    s.stage.querySelector('[data-role=cashout]')?.addEventListener('click', async () => {
      try {
        const out = await api.post('/crash/cashout', { bet: myBet?.id || s.hand?.id, multiplier: mult });
        if (out.wallet) patch({ wallet: out.wallet }, 'wallet'); else refreshWallet();
        if (out.cancelled) toast(t('crash.cancelled'));
        else { toastOk(t('crash.cashed', { multiplier: fmtMultiplier(out.multiplier), amount: fmtCredits(out.payout) })); myBet = null; }
        st = out.state || st;
        paint_();
        await s.loadHistory();
      } catch (err) { toastError(err); }
    });
    s.stage.querySelector('[data-role=cancel]')?.addEventListener('click', async () => {
      try {
        const out = await api.post('/crash/cashout', { bet: myBet.id, multiplier: 0 });
        toastOk(t('crash.cancelled')); myBet = null; st = out.state || st; paint_();
      } catch (err) { toastError(err); }
    });
    s.stage.querySelector('[data-role=verify-round]')?.addEventListener('click', () => {
      const revealed = st?.revealedSeed;
      modal({
        title: t('fairness.round_title'),
        body: html`<div class="stack">
          <dl class="kv">
            <dt>${t('fairness.server_hash')}</dt><dd class="mono">${String(st?.serverSeedHash || '—').slice(0, 32)}</dd>
            <dt>${t('fairness.nonce')}</dt><dd>${fmtNum(st?.nonce || 0)}</dd>
            <dt>${t('crash.crash_point')}</dt><dd>${fmtMultiplier(st?.crashPoint || 0)}</dd>
            <dt>${t('fairness.server_seed')}</dt><dd class="mono">${revealed || t('fairness.revealed_after')}</dd>
          </dl>
          <p class="section__sub">${t('fairness.explain')}</p></div>`,
      });
    });
  };

  const curve = () => s.stage?.querySelector('[data-role=curve]');
  function draw(points) {
    const c = curve();
    if (!c?.getContext) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(34,50,85,.9)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo(0, (H / 4) * i); ctx.lineTo(W, (H / 4) * i); ctx.stroke();
    }
    if (!points.length) return;
    const max = Math.max(2, ...points.map((p) => p[1]));
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const px = (x / Math.max(1, points.length - 1)) * W;
      const py = H - ((y - 1) / (max - 1)) * (H - 20) - 6;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = st?.status === 'crashed' ? '#f2555f' : '#22c98d';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, st?.status === 'crashed' ? 'rgba(242,85,95,.28)' : 'rgba(34,201,141,.28)');
    grad.addColorStop(1, 'rgba(4,7,16,0)');
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }

  let lastStatus = null;
  const live = () => {
    const mult = st?.multiplier || 1;
    const readout = s.stage?.querySelector('.crash-mult');
    if (readout) { readout.textContent = fmtMultiplier(mult); readout.className = `crash-mult ${st?.status === 'crashed' ? 'crash-mult--crashed' : st?.status === 'flying' ? 'crash-mult--live' : ''}`; }
    draw(pts);
  };
  const apply = (payload) => {
    if (!payload) return;
    const next = payload.state || payload;
    const statusChanged = next.status !== lastStatus;
    st = next;
    lastStatus = next.status;
    if (statusChanged && next.status === 'betting') pts = [];
    if (next.multiplier) pts = [...pts, [pts.length, next.multiplier]].slice(-160);
    if (next.status === 'crashed' && myBet && !myBet.cashed) myBet = null;
    if (statusChanged) paint_(); else live();
  };
  try { apply(await api.get('/crash')); } catch { /* offline */ }
  const { on: onLive } = await import('../core/sse.js');
  const offs = ['crash:tick', 'crash:betting', 'crash:flying', 'crash:crashed', 'crash:bet', 'crash:cashout'].map((e) => onLive(e, apply));
  const stop = every(240, () => {
    if (st?.status === 'flying') {
      st.multiplier = Math.round((st.multiplier || 1) * (1 + 0.008) * 100) / 100;
      pts = [...pts, [pts.length, st.multiplier]].slice(-160);
      live();
    }
  });
  const stopPoll = every(4000, async () => { if (!isLiveConnected()) { try { apply(await api.get('/crash')); } catch { /* offline */ } } });
  paint(s.below, '');
  paint_();
  return () => { offs.forEach((f) => f()); stop(); stopPoll(); };
}

// ---------------------------------------------------------------------------
// Generic fallback — every engine has a working, if plainer, interface.
// ---------------------------------------------------------------------------
export async function generic(s) {
  const options = s.game.config?.options || null;
  let choice = options?.[0]?.value ?? null;
  paint(s.stage, html`
    <div class="stack" style="align-items:center;width:min(520px,100%)">
      <span style="font-size:3.4rem" aria-hidden="true">${iconFor(s.game)}</span>
      <p class="section__sub center">${t(s.game.descriptionKey || 'game.generic_body')}</p>
      ${options ? html`<div class="row row--wrap" style="justify-content:center">
        ${options.map((o) => html`<button class="btn-tab" type="button" data-opt="${o.value}" aria-selected="${String(o.value === choice)}">${o.labelKey ? t(o.labelKey) : o.label}</button>`)}
      </div>` : ''}
    </div>`);
  s.stage.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => { choice = isNaN(Number(b.dataset.opt)) ? b.dataset.opt : Number(b.dataset.opt); paint_(); }));
  function paint_() { s.stage.querySelectorAll('[data-opt]').forEach((b) => b.setAttribute('aria-selected', String((isNaN(Number(b.dataset.opt)) ? b.dataset.opt : Number(b.dataset.opt)) === choice))); }
  paint(s.below, controlBar(s, { labelKey: 'btn.play' }));
  wirePlace(s, s.below.querySelector('[data-role=place]'), async () => {
    const out = await s.place(choice === null ? {} : { value: choice });
    if (out?.bet) showResult(s, out.bet);
  });
  return () => {};
}
const iconFor = (game) => ({ slots: '🎰', roulette: '🎡', dice: '🎲', mines: '💣', wheel: '🎯', plinko: '🔻', bingo: '🅱️', crash: '🚀', blackjack: '🃏', baccarat: '♠️', video_poker: '🂡', three_patti: '🎴' })[game.engine] || '🎮';

export const VIEWS = { slots, roulette, dice, mines, wheel, plinko, bingo, blackjack, video_poker, baccarat: sideBetGame('baccarat'), three_patti: sideBetGame('three_patti'), crash, generic };

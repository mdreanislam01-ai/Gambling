/** Live-casino studio. Simulated dealers and rounds, clearly labelled. */
import { html, raw, render as paint, icon, on } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtMultiplier, fmtCountdown, fmtRelative } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshWallet } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, every } from '../core/ui.js';
import { on as onLive } from '../core/sse.js';
import { rouletteBoard, describeLeg } from '../game/views.js';
import { cardFace } from '../game/session.js';
import { emptyState, demoNotice } from '../components/widgets.js';

const PHASES = { betting: 'live.phase.betting', spinning: 'live.phase.spinning', payout: 'live.phase.payout', idle: 'live.phase.idle' };

export async function render(root, ctx) {
  const tableKey = ctx.params.key || null;
  if (!tableKey) return listPage(root, ctx);
  return studioPage(root, ctx, tableKey);
}

async function listPage(root, ctx) {
  paint(root, html`<div class="container container--wide stack"><div class="skel skel--line"></div><div class="skel skel--card" style="height:220px"></div></div>`);
  let data = null;
  try { data = await api.get('/live/tables'); } catch (err) {
    paint(root, html`<div class="container"><div class="panel"><div class="panel__body">${emptyState({ icon: 'warn', titleKey: 'err.load_tables', bodyKey: 'err.load_tables_body' })}</div></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const rows = data.rows || [];
  paint(root, html`
    <div class="container container--wide stack">
      <div class="section__head">
        <div class="grow"><h1 class="section__title">${t('live.title')}</h1>
          <p class="section__sub">${t('live.sub')}</p></div>
        <span class="chip chip--red chip--live">${t('live.simulated')}</span>
      </div>
      ${demoNotice('live.simulated_note')}
      ${rows.length ? html`
        <div class="live-grid">
          ${rows.map((tb) => tableCard(tb, tb.live))}
        </div>` : emptyState({ icon: 'live', titleKey: 'empty.live', bodyKey: 'empty.live_body' })}
      <section class="panel">
        <div class="panel__head">${icon('info', 16)}<h3>${t('live.how_title')}</h3></div>
        <div class="panel__body grid-3">
          ${['live.how_1', 'live.how_2', 'live.how_3'].map((k, i) => html`
            <div><h4>${fmtNum(i + 1)}. ${t(`live.how_h${i + 1}`)}</h4><p class="section__sub">${t(k)}</p></div>`)}
        </div>
      </section>
    </div>`);
  const offs = rows.map((tb) => onLive(`live:phase:${tb.key}`, (p) => {
    const card = root.querySelector(`[data-table="${tb.key}"]`);
    if (card) paint(card, tableInner(tb, p));
  }));
  const stop = every(3000, async () => {
    if (document.hidden) return;
    try {
      const fresh = await api.get('/live/tables');
      for (const tb of fresh.rows || []) {
        const card = root.querySelector(`[data-table="${tb.key}"]`);
        if (card) paint(card, tableInner(tb, tb.live));
      }
    } catch { /* offline */ }
  });
  return () => { offs.forEach((f) => f()); stop(); };
}

const tableCard = (tb, live) => html`
  <article class="live-card" data-table="${tb.key}">${tableInner(tb, live)}</article>`;

function tableInner(tb, live = {}) {
  const phase = live.status || 'betting';
  const endsAt = live.phaseEndsAt ? Date.parse(String(live.phaseEndsAt).replace(' ', 'T') + (String(live.phaseEndsAt).endsWith('Z') ? '' : 'Z')) : null;
  const spin = live.spin;
  return html`
    <div class="live-card__view">
      <div class="live-scan" aria-hidden="true"></div>
      <span class="chip chip--red chip--live" style="position:absolute;top:8px;left:8px">${t('live.simulated')}</span>
      <span class="chip chip--soft" style="position:absolute;top:8px;right:8px">${t(PHASES[phase] || PHASES.idle)}</span>
      <div class="stack center" style="align-items:center;padding:14px">
        ${spin?.number !== undefined ? html`<span class="num-pill num-pill--${spin.info?.color || 'black'}" style="width:44px;height:44px;font-size:1.1rem">${spin.number}</span>` : ''}
        ${spin?.playerTotal !== undefined ? html`
          <div class="row" style="gap:10px;justify-content:center">
            <span class="chip chip--blue">P ${fmtNum(spin.playerTotal)}</span><span class="chip chip--red">B ${fmtNum(spin.bankerTotal)}</span>
          </div>` : ''}
        ${spin?.segment !== undefined ? html`<span class="chip chip--gold">${t('live.segment', { n: fmtNum(spin.segment + 1) })}</span>` : ''}
        ${!spin ? html`<span style="font-size:2.2rem" aria-hidden="true">${tb.engine === 'roulette' ? '🎡' : tb.engine === 'baccarat' ? '♠️' : tb.engine === 'wheel' ? '🎯' : '🃏'}</span>` : ''}
        <div class="section__sub">${endsAt ? html`<span data-countdown="${endsAt}">${fmtCountdown(endsAt)}</span>` : t('live.waiting')}</div>
      </div>
    </div>
    <div class="card__body">
      <div class="row"><strong class="grow">${tb.name}</strong><span class="chip chip--soft">${t(`cat.${tb.engine === 'roulette' ? 'table' : 'live'}`)}</span></div>
      <div class="card__meta">
        <span>${t('live.dealer', { name: tb.dealer || t('live.dealer_generic') })}</span>
        <span>· ${t('live.players', { count: fmtNum(live.players ?? tb.players ?? 0) })}</span>
        <span>· ${fmtCredits(tb.minBet)}–${fmtCredits(tb.maxBet)}</span>
      </div>
      <div class="row" style="margin-top:6px">
        <a class="btn btn--sm btn--gold grow" href="/live/${tb.key}" data-link>${t('btn.join_table')}</a>
        <a class="btn btn--sm btn--ghost" href="/game/${tb.gameKey}" data-link>${t('btn.demo_version')}</a>
      </div>
    </div>
    ${(live.history?.length ? live.history : []).slice(0, 6).length ? html`
      <div class="recent-numbers" style="padding:0 12px 10px">
        ${live.history.slice(0, 6).map((h) => h?.number !== undefined
    ? html`<span class="num-pill num-pill--${h.info?.color || 'black'}">${h.number}</span>`
    : h?.playerTotal !== undefined ? html`<span class="chip chip--soft">${fmtNum(h.playerTotal)}–${fmtNum(h.bankerTotal)}</span>` : '')}
      </div>` : ''}`;
}

async function studioPage(root, ctx, key) {
  let data;
  try { data = await api.get(`/live/${encodeURIComponent(key)}`); } catch (err) {
    paint(root, html`<div class="container"><div class="panel"><div class="panel__body empty">
      <h2>${t(err?.code || 'live.table_not_found')}</h2>
      <a class="btn btn--gold" href="/live" data-link>${t('btn.back_live')}</a></div></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const table = data.table || {};
  const legs = [];
  let chip = Math.max(table.minBet || 100, 500);
  const chat = [];
  let live = data;

  paint(root, html`
    <div class="container container--wide stack">
      <nav class="row" aria-label="${t('a11y.crumbs')}" style="font-size:.8rem;color:var(--muted)">
        <a href="/live" data-link>${t('nav.live')}</a><span>/</span><span style="color:var(--text)">${table.name || key}</span>
        <span class="chip chip--red chip--live">${t('live.simulated')}</span>
      </nav>
      <div class="layout-game">
        <div class="stack">
          <section class="stage stage--felt" style="min-height:auto;padding:0;overflow:hidden">
            <div class="live-card__view" style="aspect-ratio:21/9;min-height:200px">
              <div class="live-scan" aria-hidden="true"></div>
              <div class="stack center" style="align-items:center;gap:8px">
                <div class="row" style="gap:10px"><span class="avatar" aria-hidden="true">${(table.dealer || 'D')[0]}</span>
                  <div class="center" style="text-align:left"><strong>${table.dealer || t('live.dealer_generic')}</strong>
                    <div class="section__sub">${t('live.dealer_of', { studio: table.studio || t('live.studio_generic') })}</div></div></div>
                <div class="result-banner" data-role="spin" style="min-width:220px"></div>
                <div class="section__sub" data-role="phase"></div>
              </div>
            </div>
            <div class="panel__body" data-role="board"></div>
          </section>
          <div data-role="result"></div>
        </div>
        <aside class="layout-game__side stack">
          <section class="panel">
            <div class="panel__head">${icon('chips', 16)}<h3>${t('live.your_bets')}</h3></div>
            <div class="panel__body stack" data-role="mybets"></div>
          </section>
          <section class="panel">
            <div class="panel__head">${icon('live', 16)}<h3>${t('live.round')}</h3></div>
            <div class="panel__body stack" data-role="round"></div>
          </section>
          <section class="panel">
            <div class="panel__head">${icon('chat', 16)}<h3>${t('live.chat')}</h3>
              <span class="grow"></span><span class="chip chip--soft">${t('live.chat_note')}</span></div>
            <div class="panel__body dealer-chat" data-role="chat"></div>
          </section>
          ${demoNotice('live.simulated_note')}
        </aside>
      </div>
    </div>`);

  const boardHost = root.querySelector('[data-role=board]');
  const paintBoard = () => {
    const open = live.status === 'betting';
    if (table.engine === 'roulette') paint(boardHost, html`${rouletteBoard()}${controls()}`);
    else paint(boardHost, html`
      <div class="stack">
        <div class="grid-3">${sidesFor(table.engine).map((sd) => html`
          <button class="card" type="button" data-side="${sd.side}" style="padding:12px;text-align:center" ${open ? '' : 'disabled'}>
            <div class="card__title">${t(sd.labelKey)}</div><div class="card__meta" style="justify-content:center"><span class="mono">${sd.pay}</span></div>
            <div class="chip chip--soft">${fmtCredits(chip)}</div></button>`)}
        </div>
        <div class="row row--wrap" style="gap:6px">${[250, 500, 1000, 2500].map((c) => html`
          <button class="btn btn--sm ${c === chip ? 'btn--gold' : ''}" type="button" data-chip="${c}">${fmtCredits(c, { withSymbol: false })}</button>`)}</div>
        ${controls()}
      </div>`);

    function controls() {
      return html`
        <div class="row row--wrap" style="margin-top:10px;gap:8px">
          <span class="chip chip--soft">${t('bet.stake')}: <b class="mono">${fmtCredits(legs.reduce((a, l) => a + l.amount, 0))}</b></span>
          <span class="grow"></span>
          <button class="btn btn--sm btn--ghost" type="button" data-clear>${t('btn.clear')}</button>
          <button class="btn btn--gold" type="button" data-role="bet" ${open && legs.length && state.user ? '' : 'disabled'}>
            ${open ? t('btn.place_bet') : t('live.closed')}</button>
        </div>
        ${!state.user ? html`<p class="section__sub">${t('live.login_to_bet')} <a href="/login?next=${encodeURIComponent('/live/' + key)}" data-link>${t('auth.login')}</a></p>` : ''}
        ${legs.length ? html`<div class="paytable">${legs.map((l, i) => html`
          <div><span>${legLabel(l)}</span><b class="row" style="gap:6px">${fmtCredits(l.amount)}
            <button class="btn btn--sm btn--ghost" type="button" data-rm="${i}" aria-label="${t('btn.remove')}">${icon('close', 12)}</button></b></div>`)}</div>` : ''}`;
    }
    on(boardHost, 'click', '[data-chip]', (ev, b) => { chip = Number(b.dataset.chip); paintBoard(); });
    on(boardHost, 'click', '[data-bet]', (ev, b) => { if (live.status !== 'betting') return; legs.push(JSON.parse(b.dataset.bet)); paintBoard(); });
    on(boardHost, 'click', '[data-side]', (ev, b) => { if (live.status !== 'betting') return; legs.push({ side: b.dataset.side, amount: chip }); paintBoard(); });
    on(boardHost, 'click', '[data-rm]', (ev, b) => { legs.splice(Number(b.dataset.rm), 1); paintBoard(); });
    on(boardHost, 'click', '[data-clear]', () => { legs.length = 0; paintBoard(); });
    boardHost.querySelector('[data-role=bet]')?.addEventListener('click', placeBet);
  };

  const legLabel = (l) => (l.type ? describeLeg(l) : t(sidesFor(table.engine).find((x) => x.side === l.side)?.labelKey || l.side));

  async function placeBet() {
    if (!state.user) { navigate('/login?next=' + encodeURIComponent('/live/' + key)); return; }
    if (!legs.length) { toast(t('live.pick_bet')); return; }
    const stake = legs.reduce((a, l) => a + l.amount, 0);
    try {
      const out = await api.post(`/live/${encodeURIComponent(key)}/bet`, { stakeCents: stake, selection: { bets: legs.map((l) => ({ ...l, amount: l.amount })) } });
      if (out.wallet) patch({ wallet: out.wallet }, 'wallet'); else refreshWallet();
      toastOk(t('live.bet_placed', { stake: fmtCredits(stake) }));
      legs.length = 0;
      live = out.state ? { ...live, ...out.state } : live;
      paintBoard();
      paintMeta();
    } catch (err) { toastError(err); }
  }

  const sidesFor = (engine) => (engine === 'baccarat'
    ? [{ side: 'player', labelKey: 'bacc.player', pay: '1:1' }, { side: 'banker', labelKey: 'bacc.banker', pay: '0.95:1' }, { side: 'tie', labelKey: 'bacc.tie', pay: '8:1' }, { side: 'pair_player', labelKey: 'bacc.pair_player', pay: '11:1' }, { side: 'pair_banker', labelKey: 'bacc.pair_banker', pay: '11:1' }]
    : engine === 'wheel'
      ? WHEEL_TARGETS().map((m) => ({ side: `target:${m}`, labelKey: 'wheel.target', pay: `${m}×` }))
      : [{ side: 'player', labelKey: 'bacc.player', pay: '1:1' }]);
  const WHEEL_TARGETS = () => [1.5, 2, 3, 5];

  const paintSpin = () => {
    const spin = live.spin;
    const box = root.querySelector('[data-role=spin]');
    if (!box) return;
    if (spin?.number !== undefined) paint(box, html`<span class="num-pill num-pill--${spin.info?.color || 'black'}" style="width:52px;height:52px;font-size:1.3rem">${spin.number}</span>`);
    else if (spin?.playerTotal !== undefined) paint(box, html`
      <div class="row" style="gap:12px">
        <div class="center"><div class="section__sub">${t('bacc.player')}</div>${raw((spin.player || []).map(cardFace).join(''))}</div>
        <div class="center"><div class="section__sub">${t('bacc.banker')}</div>${raw((spin.banker || []).map(cardFace).join(''))}</div>
        <strong>${fmtNum(spin.playerTotal)} : ${fmtNum(spin.bankerTotal)}</strong>
      </div>`);
    else if (spin?.segment !== undefined) paint(box, html`<strong>${t('live.segment', { n: fmtNum(spin.segment + 1) })}</strong>`);
    else paint(box, html`<span class="section__sub">${t('live.waiting')}</span>`);
  };
  const paintMeta = () => {
    paint(root.querySelector('[data-role=round]'), html`
      <dl class="kv">
        <dt>${t('live.phase_label')}</dt><dd>${t(PHASES[live.status] || PHASES.idle)}</dd>
        <dt>${t('live.round_id')}</dt><dd class="mono">${live.roundId ?? '—'}</dd>
        <dt>${t('fairness.server_hash')}</dt><dd class="mono">${String(live.serverSeedHash || '—').slice(0, 16)}…</dd>
        <dt>${t('live.seats')}</dt><dd>${fmtNum(live.participantCount || 0)} / ${fmtNum(table.seats || 0)}</dd>
        <dt>${t('live.players')}</dt><dd>${fmtNum(live.players || table.players || 0)}</dd>
      </dl>
      ${live.history?.length ? html`<div class="recent-numbers" style="margin-top:8px">
        ${live.history.slice(0, 10).map((h) => h?.number !== undefined
    ? html`<span class="num-pill num-pill--${h.info?.color || 'black'}">${h.number}</span>`
    : html`<span class="chip chip--soft">${h?.playerTotal !== undefined ? `${fmtNum(h.playerTotal)}–${fmtNum(h.bankerTotal)}` : '·'}</span>`)}</div>` : ''}`);
    const my = live.myBets || [];
    paint(root.querySelector('[data-role=mybets]'), my.length ? html`
      <div class="list-divided">
        ${my.map((b) => html`<div class="row" style="gap:8px">
          <span class="badge badge--${b.status}">${t(`bet.status.${b.status}`)}</span>
          <span class="grow mono" style="font-size:.76rem">${b.bet}</span>
          <span class="mono">${fmtCredits(b.stake)}${b.payout ? ` → ${fmtCredits(b.payout)}` : ''}</span>
        </div>${(b.selection?.bets || []).map((l) => html`<div class="section__sub" style="font-size:.76rem">${legLabel(l)} · ${fmtCredits(l.amount || 0)}</div>`)}`)}
      </div>` : html`<p class="section__sub">${t('live.no_bets')}</p>`);
    paint(root.querySelector('[data-role=phase]'), html`
      <div class="row" style="gap:10px">
        <span class="chip ${live.status === 'betting' ? 'chip--green' : 'chip--soft'}">${t(PHASES[live.status] || PHASES.idle)}</span>
        ${live.phaseEndsAt ? html`<span class="section__sub" data-countdown="${parseEnds(live.phaseEndsAt)}">${fmtCountdown(parseEnds(live.phaseEndsAt))}</span>` : ''}
      </div>`);
  };
  const paintChat = () => {
    const host = root.querySelector('[data-role=chat]');
    if (!host) return;
    paint(host, html`
      ${chat.slice(-8).map((l) => html`<div class="chat-line ${l.me ? 'chat-line--you' : ''}">
        <span class="chat-line__who">${l.me ? t('live.you') : (table.dealer || t('live.dealer_generic'))}</span><span>${l.text}</span></div>`)}
      <p class="section__sub" style="margin:0">${t('live.chat_disclaimer')}</p>`);
  };

  function parseEnds(v) {
    if (!v) return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(' ', 'T');
    return Date.parse(s.endsWith('Z') ? s : `${s}Z`);
  }

  paintBoard();
  paintSpin();
  paintMeta();
  chat.push({ text: t('live.welcome', { name: state.user?.displayName || t('live.guest') }) });
  paintChat();

  const refresh = async () => {
    try {
      const next = await api.get(`/live/${encodeURIComponent(key)}`);
      const prevStatus = live.status;
      live = next;
      if (prevStatus !== live.status) {
        if (live.status === 'spinning') chat.push({ text: t('live.no_more_bets') });
        if (live.status === 'payout') { chat.push({ text: dealerLine(live) }); await refreshWallet(); await loadResult(); }
        paintSpin();
        paintBoard();
      }
      paintMeta();
    } catch { /* transient */ }
  };
  async function loadResult() {
    if (!state.user) return;
    try {
      const r = await api.get(`/bets?kind=live&limit=4&gameKey=${encodeURIComponent(table.gameKey || '')}`);
      const last = (r.rows || [])[0];
      if (last) {
        paint(root.querySelector('[data-role=result]'), last.payout > last.stake
          ? html`<div class="result-banner result-banner--won"><span>${t('bet.status.won')}</span><strong>+${fmtCredits(last.payout)}</strong>
             <span class="section__sub">${t('bet.multiplier')} ${fmtMultiplier(last.multiplier || 0)}</span></div>`
          : html`<div class="result-banner result-banner--lost"><span>${t(`bet.status.${last.status}`)}</span><strong>−${fmtCredits(last.stake)}</strong></div>`);
      }
    } catch { /* ignore */ }
  }
  const off1 = onLive(`live:phase:${key}`, (p) => { live = { ...live, ...p }; paintSpin(); paintMeta(); paintBoard(); if (p.status === 'payout') loadResult(); });
  const off2 = onLive('live:round', (p) => { if (p?.tableKey === key) { live = { ...live, ...p }; paintSpin(); paintMeta(); } });
  const stop = every(2000, refresh);
  const stopTick = every(1000, () => {
    for (const n of root.querySelectorAll('[data-countdown]')) {
      const target = Number(n.dataset.countdown);
      if (target) n.textContent = fmtCountdown(target);
    }
  });
  loadResult();
  return () => { off1(); off2(); stop(); stopTick(); };
}

const dealerLine = (live) => {
  const spin = live?.spin;
  if (!spin) return t('live.dealer_line_idle');
  if (spin.number !== undefined) return t('live.dealer_line_number', { number: spin.number, colour: t(`roulette.colour.${spin.info?.color || 'black'}`) });
  if (spin.playerTotal !== undefined) return t('live.dealer_line_baccarat', { player: spin.playerTotal, banker: spin.bankerTotal });
  if (spin.segment !== undefined) return t('live.dealer_line_wheel', { segment: spin.segment + 1 });
  return t('live.dealer_line_idle');
};

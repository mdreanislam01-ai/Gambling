/**
 * One object per open game page: stake control, bet placement, pending-hand
 * actions, wallet sync, history and fairness. Engine views only talk to this.
 */
import { html, render as paint, icon } from '../core/dom.js';
import { t, fmtCredits, fmtNum, fmtMultiplier, fmtRelative } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshWallet, toggleFavoriteLocal } from '../core/state.js';
import { toast, toastOk, toastError, celebrate } from '../core/ui.js';
import { betPanel } from '../components/widgets.js';

export class GameSession {
  constructor({ game, host, onChange = () => {} }) {
    this.game = game;
    this.host = host;
    this.onChange = onChange;
    this.stake = clampStake(game, Math.max(game.minBet || 100, state.lastStake?.[game.key] || 1000));
    this.selection = {};
    this.lastBet = null;
    this.hand = null;
    this.busy = false;
    this.history = [];
    this.wallet = state.wallet ? { ...state.wallet } : null;
    this.fair = null;
    this.notice = null;
  }

  /** Render the standard two-column layout and mount the engine view. */
  async mount(viewFn) {
    paint(this.host, html`
      <div class="layout-game">
        <div class="stack">
          <div class="stage" data-role="stage"><div class="row" style="gap:10px"><span class="spinner"></span><span class="section__sub">${t('game.loading')}</span></div></div>
          <div data-role="below"></div>
        </div>
        <aside class="layout-game__side stack" data-role="side"></aside>
      </div>`);
    this.stage = this.host.querySelector('[data-role=stage]');
    this.below = this.host.querySelector('[data-role=below]');
    this.side = this.host.querySelector('[data-role=side]');
    this.betBox = document.createElement('div');
    this.betBox.className = 'panel';
    this.side.append(this.betBox);
    this.controls = betPanel(this.betBox, {
      game: this.game,
      stake: this.stake,
      disabled: !state.user,
      onChange: (v, setError) => { this.stake = v; this.setError = setError; this.validateSelection?.(); },
    });
    this.renderSide();
    this.renderNotice();
    await Promise.all([this.loadHistory(), this.resumeHand()]);
    try { viewFn?.(this); } catch (err) { console.error('[view]', err); paint(this.stage, this.errorBox(err)); }
    this.onChange();
    return this;
  }

  errorBox(err) {
    return html`<div class="empty"><span class="empty__icon">${icon('warn', 26)}</span>
      <h3>${t('err.load_game')}</h3><p class="section__sub">${err?.message || ''}</p></div>`;
  }

  renderNotice() {
    const box = this.host.querySelector('[data-role=notice]');
    const text = this.game.multiStep ? t('game.notice_multistep') : t('game.notice_instant');
    if (box) box.innerHTML = '';
    const existing = this.stage?.querySelector('.stage__notice');
    if (existing) existing.remove();
    this.stage?.insertAdjacentHTML('afterbegin', `<span class="chip chip--soft stage__notice">${t('app.demo_badge')} · ${text}</span>`);
  }

  renderSide() {
    const g = this.game;
    const extra = document.createElement('div');
    paint(extra, html`
      <section class="panel side-card">
        <div class="panel__head">${icon('info', 16)}<h3>${t('game.info')}</h3></div>
        <div class="panel__body">
          <dl class="kv">
            <dt>${t('game.rtp')}</dt><dd>${g.rtpBps ? `${fmtNum(g.rtpBps / 100, { max: 2 })}%` : '—'}</dd>
            <dt>${t('game.house_edge')}</dt><dd>${g.houseEdgeBps ? `${fmtNum(g.houseEdgeBps / 100, { max: 2 })}%` : '—'}</dd>
            <dt>${t('game.volatility')}</dt><dd>${t(`game.vol.${g.volatility || 'medium'}`)}</dd>
            <dt>${t('game.min')} / ${t('game.max')}</dt><dd>${fmtCredits(g.minBet)} – ${fmtCredits(g.maxBet)}</dd>
            <dt>${t('game.engine')}</dt><dd>${g.engine}</dd>
          </dl>
        </div>
      </section>
      <section class="panel side-card">
        <div class="panel__head">${icon('shield', 16)}<h3>${t('game.fairness')}</h3></div>
        <div class="panel__body stack" data-role="fairness">
          <p class="section__sub">${t('fairness.explain')}</p>
        </div>
      </section>`);
    // keep bet panel first, then info blocks
    const bet = this.betBox;
    this.side.innerHTML = '';
    this.side.append(bet, extra);
    this.mountFairness(this.side.querySelector('[data-role=fairness]'));
    this.renderHistoryCard();
  }

  async mountFairness(host) {
    if (!host) return;
    if (!state.user) {
      host.insertAdjacentHTML('beforeend', `<a class="btn btn--sm" href="/login" data-link>${t('auth.login')}</a>`);
      return;
    }
    try {
      const f = await api.cached('/fairness', 30000);
      const c = f.current || {};
      this.fair = c;
      host.insertAdjacentHTML('beforeend', `
        <dl class="kv">
          <dt>${t('fairness.server_hash')}</dt><dd class="mono">${short(c.serverSeedHash)}</dd>
          <dt>${t('fairness.client_seed')}</dt><dd class="mono">${short(c.clientSeed || 'player')}</dd>
          <dt>${t('fairness.next_nonce')}</dt><dd>${fmtNum(c.nextNonce ?? 0)}</dd>
        </dl>
        <div class="row" style="gap:6px">
          <button class="btn btn--sm" type="button" data-act="rotate">${t('fairness.rotate')}</button>
          <button class="btn btn--sm" type="button" data-act="seed">${t('fairness.set_client_seed')}</button>
        </div>`);
      host.querySelector('[data-act=rotate]')?.addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        try { await api.post('/fairness/rotate'); api.invalidate('/fairness'); toastOk(t('fairness.rotated')); await this.reload(); }
        catch (err) { toastError(err); } finally { ev.currentTarget.disabled = false; }
      });
      host.querySelector('[data-act=seed]')?.addEventListener('click', async () => {
        const value = prompt(t('fairness.seed_prompt'), c.clientSeed || 'player');
        if (value === null) return;
        try { await api.post('/fairness/client-seed', { clientSeed: value }); api.invalidate('/fairness'); toastOk(t('fairness.seed_saved')); }
        catch (err) { toastError(err); }
      });
    } catch { /* guest or offline */ }
  }

  renderHistoryCard() {
    const card = document.createElement('section');
    card.className = 'panel side-card';
    card.innerHTML = `
      <div class="panel__head">${icon('clock', 16)}<h3>${t('game.history')}</h3></div>
      <div class="panel__body panel__body--tight" data-role="history"></div>`;
    this.side.append(card);
    this.historyHost = card.querySelector('[data-role=history]');
    this.paintHistory();
  }

  paintHistory() {
    if (!this.historyHost) return;
    if (!this.history.length) { this.historyHost.innerHTML = `<p class="section__sub">${t('empty.history')}</p>`; return; }
    this.historyHost.innerHTML = this.history.slice(0, 8).map((b) => `
      <div class="row" style="padding:6px 4px;gap:8px;border-bottom:1px solid var(--line-soft)">
        <span class="badge badge--${b.status}">${t(`bet.status.${b.status}`)}</span>
        <span class="grow mono" style="font-size:.78rem">${fmtMultiplier(b.multiplier || 0)}</span>
        <span class="mono" style="font-size:.8rem;color:${b.payout > b.stake ? 'var(--green)' : 'var(--muted)'}">
          ${b.payout > b.stake ? `+${fmtCredits(b.payout - b.stake)}` : `−${fmtCredits(b.stake)}`}</span>
        <span class="section__sub" style="font-size:.7rem">${fmtRelative(b.settledAt || b.createdAt)}</span>
      </div>`).join('');
  }

  async loadHistory() {
    if (!state.user) return;
    try {
      const r = await api.get(`/bets?gameKey=${encodeURIComponent(this.game.key)}&limit=12`);
      this.history = r.rows || [];
      this.paintHistory();
    } catch { /* ignore */ }
  }

  /** Resume a pending multi-step hand (blackjack / video poker / mines). */
  async resumeHand() {
    if (!state.user || !this.game.multiStep) return;
    try {
      const r = await api.get(`/bets/active?gameKey=${encodeURIComponent(this.game.key)}`);
      if (r?.hand) { this.hand = r.hand; toast(t('game.resumed_hand')); }
    } catch { /* none */ }
  }

  get total() { return this.wallet?.balance ?? 0; }

  setStake(v) { this.controls?.set(v); }
  setError(msg) { this.notice = msg || null; this.renderNotice(); }

  /** Place (or continue) a bet. Engine views pass the selection object. */
  async place(selection = this.selection, { silent = false } = {}) {
    if (!state.user) { toast(t('auth.need_login')); location.assign('/login?next=' + encodeURIComponent(location.pathname)); return null; }
    if (this.busy) return null;
    this.busy = true;
    this.setBusy(true);
    try {
      const body = { stakeCents: this.stake, selection: selection || {} };
      const out = await api.post(`/games/${this.game.key}/bet`, body);
      this.applyBet(out);
      if (!silent) this.announceResult(out);
      state.lastStake = { ...(state.lastStake || {}), [this.game.key]: this.stake };
      return out;
    } catch (err) {
      toastError(err);
      this.setError(err?.code ? t(err.code, err.params || {}) : err?.message);
      throw err;
    } finally {
      this.busy = false;
      this.setBusy(false);
    }
  }

  /** Multi-step action on an open hand (hit/stand/double/pick/cashout/hold). */
  async act(action, selection = {}) {
    if (!this.hand) return null;
    this.busy = true;
    this.setBusy(true);
    try {
      const out = await api.post(`/bets/${this.hand.id}/action`, { action, selection });
      this.applyBet(out);
      if (out.pending === false) this.announceResult(out);
      return out;
    } catch (err) {
      toastError(err);
      this.hand = null;
      throw err;
    } finally {
      this.busy = false;
      this.setBusy(false);
    }
  }

  async abandon() {
    if (!this.hand) return;
    try {
      const out = await api.post(`/bets/${this.hand.id}/abandon`);
      this.applyBet(out);
      this.hand = null;
      toast(t('game.hand_abandoned'));
    } catch (err) { toastError(err); }
  }

  applyBet(out) {
    if (!out) return;
    if (out.wallet) patch({ wallet: out.wallet }, 'wallet');
    this.wallet = out.wallet || this.wallet;
    this.lastBet = out.bet || this.lastBet;
    if (out.pending) {
      this.hand = { ...(out.bet || {}), view: out.view, actions: out.actions || out.view?.actions || [] };
    } else if (out.bet) {
      this.hand = null;
      if (out.bet) this.history = [out.bet, ...this.history.filter((b) => b.id !== out.bet.id)].slice(0, 20);
      this.paintHistory();
      refreshWallet();
      api.invalidate('/bets');
      api.invalidate(`/games/${this.game.key}`);
    }
    this.onChange(this);
    this.renderNotice();
  }

  announceResult(out) {
    const bet = out?.bet;
    if (!bet) return;
    const won = bet.payout > bet.stake;
    if (won) {
      toastOk(t('game.result_won', { amount: fmtCredits(bet.payout), multiplier: fmtMultiplier(bet.multiplier || bet.payout / Math.max(1, bet.stake)) }));
      if ((bet.multiplier || 0) >= 10) celebrate(Math.min(3, (bet.multiplier || 0) / 10));
    } else if (bet.status === 'void') toast(t('game.result_push'));
    else if (bet.status === 'pending') { /* hand continues */ }
    else toast(t('game.result_lost', { amount: fmtCredits(bet.stake) }), { type: 'warn' });
  }

  setBusy(flag) {
    for (const btn of this.host.querySelectorAll('[data-role=place]')) {
      btn.disabled = !!flag;
      if (flag) btn.dataset.wasLabel = btn.dataset.wasLabel || btn.innerHTML;
      else if (btn.dataset.wasLabel) btn.innerHTML = btn.dataset.wasLabel;
    }
  }

  /** Shared primary button markup for engine views. */
  placeButton(labelKey = 'btn.place_bet', extra = '') {
    return `<button class="btn btn--gold btn--block btn--lg" type="button" data-role="place">${
      t(labelKey)}${extra}</button>`;
  }
}

export const clampStake = (game, v) => Math.min(game.maxBet || 1e9, Math.max(game.minBet || 100, Math.round(Number(v) || 0)));
export const short = (s) => (s ? `${String(s).slice(0, 14)}…` : '—');

/** Amounts the sidebar paytables share. */
export function paytable(rows) {
  return html`<div class="paytable">${rows.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>`;
}

export function resultBanner(bet, { extra = '' } = {}) {
  if (!bet) return '';
  const won = bet.status === 'won' || bet.status === 'cashout';
  const cls = bet.status === 'void' ? 'void' : won ? 'won' : 'lost';
  return html`
    <div class="result-banner result-banner--${cls}" role="status">
      <span>${t(`bet.status.${bet.status}`)}</span>
      <strong>${won ? `+${fmtCredits(bet.payout)}` : bet.status === 'void' ? t('game.result_push') : `−${fmtCredits(bet.stake)}`}</strong>
      <span class="section__sub">${t('bet.multiplier')} ${fmtMultiplier(bet.multiplier || 0)} · ${bet.id ? html`<button class="btn btn--sm btn--ghost" type="button" data-verify="${bet.id}">${t('fairness.verify')}</button>` : ''}</span>
      ${extra}
    </div>`;
}

export function cardRow(cards, { hiddenCount = 0, small = false } = {}) {
  const list = (cards || []).map((c) => cardFace(c, small));
  for (let i = 0; i < hiddenCount; i += 1) list.push('<span class="play-card play-card--hidden" aria-hidden="true"></span>');
  return { __raw: `<div class="cards-row">${list.join('')}</div>` };
}

const SUIT_MAP = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = new Set(['h', 'd']);
export function cardFace(card, small = false) {
  if (!card) return '';
  const id = String(card);
  const rank = id.slice(0, -1).toUpperCase().replace('10', 'T');
  const suit = id.slice(-1).toLowerCase();
  const sym = SUIT_MAP[suit] || '♠';
  const label = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' }[rank] || rank;
  return `<span class="play-card${RED.has(suit) ? ' is-red' : ''}${small ? ' play-card--sm' : ''}" aria-label="${label} ${t(`card.suit.${suit}`)}">
    <span class="play-card__rank">${label}</span><span class="play-card__suit">${sym}</span></span>`;
}

/** Verify any settled bet against the published seeds (provably fair panel). */
export { openVerifier } from '../components/verify.js';

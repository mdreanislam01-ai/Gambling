/** Provably-fair verification panel, shared by the game pages and /fairness. */
import { html, render as paint, icon } from '../core/dom.js';
import { t, fmtNum, fmtCredits, fmtMultiplier } from '../core/i18n.js';
import { api } from '../core/api.js';
import { modal, toastError } from '../core/ui.js';

export function verificationHtml(v) {
  if (!v || v.ok === undefined) return html`<p class="section__sub">${t('fairness.none')}</p>`;
  const reason = `fairness.reason.${v.reason || 'unknown'}`;
  return html`
    <div class="stack">
      <div class="notice ${v.ok ? 'notice--info' : 'notice--warn'}" role="status">
        ${icon(v.ok ? 'check' : 'warn', 18)}
        <div><strong>${t(v.ok ? 'fairness.valid' : 'fairness.invalid')}</strong>
          <div class="section__sub">${t(reason, v)}</div></div>
      </div>
      <dl class="kv">
        <dt>${t('fairness.game')}</dt><dd>${v.gameKey || v.stored?.gameKey || '—'}</dd>
        <dt>${t('fairness.hash_match')}</dt><dd>${v.hashMatches === undefined ? '—' : (v.hashMatches ? t('btn.yes') : t('btn.no'))}</dd>
        <dt>${t('fairness.server_seed')}</dt><dd class="mono" style="word-break:break-all">${v.serverSeed || '—'}</dd>
        <dt>${t('fairness.client_seed')}</dt><dd class="mono">${v.clientSeed || 'player'}</dd>
        <dt>${t('fairness.nonce')}</dt><dd>${fmtNum(v.nonce ?? 0)}</dd>
      </dl>
      ${v.recomputed || v.stored ? html`
        <div class="table-wrap table-wrap--cards"><table class="data">
          <thead><tr><th scope="col">${t('fairness.comparison')}</th><th class="num" scope="col">${t('fairness.recomputed')}</th><th class="num" scope="col">${t('fairness.stored')}</th></tr></thead>
          <tbody>
            <tr><td>${t('history.payout')}</td><td class="num">${fmtCredits(v.recomputed?.payout ?? 0)}</td><td class="num">${fmtCredits(v.stored?.payout ?? 0)}</td></tr>
            <tr><td>${t('history.status')}</td><td class="num">${t(`bet.status.${v.recomputed?.status}`, { defaultValue: v.recomputed?.status || '—' })}</td>
              <td class="num">${t(`bet.status.${v.stored?.status}`, { defaultValue: v.stored?.status || '—' })}</td></tr>
            <tr><td>${t('bet.multiplier')}</td><td class="num">${fmtMultiplier(v.recomputed?.multiplier || 0)}</td><td class="num">${fmtMultiplier(v.stored?.multiplier || 0)}</td></tr>
          </tbody>
        </table></div>` : ''}
      ${v.expectedHash ? html`<p class="section__sub mono">${t('fairness.expected_hash')}: ${v.expectedHash}</p>` : ''}
      ${v.note ? html`<p class="section__sub">${v.note}</p>` : ''}
    </div>`;
}

export async function openVerifier(betId, titleKey = 'fairness.verify') {
  if (!betId) { toastError(new Error(t('fairness.need_ref'))); return; }
  const wrap = document.createElement('div');
  paint(wrap, html`<div class="stack"><div class="row"><span class="spinner"></span><span class="section__sub">${t('fairness.computing')}</span></div></div>`);
  const m = modal({ title: t(titleKey), wide: true, body: wrap });
  try {
    const v = await api.get(`/fairness/verify/${encodeURIComponent(betId)}`);
    paint(wrap, verificationHtml({ ...v, gameKey: v.gameKey }));
  } catch (err) {
    paint(wrap, html`<div class="notice notice--warn">${icon('warn', 18)}<div>${t(err?.code || 'err.verify_failed', err?.params || {})}</div></div>`);
  }
  return m;
}

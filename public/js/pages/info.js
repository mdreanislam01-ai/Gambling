/** Policy documents, provably-fair centre, help + 404. All copy is server-localised. */
import { html, render as paint, icon } from '../core/dom.js';
import { t, fmtNum, fmtDateTime, fmtRelative, fmtCredits, isBengali, locale } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshSession } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, modal } from '../core/ui.js';
import { emptyState, demoNotice, dataTable } from '../components/widgets.js';
import { verificationHtml, openVerifier } from '../components/verify.js';

const DOCS = [
  { key: 'terms', labelKey: 'legal.terms', icon: 'shield' },
  { key: 'privacy', labelKey: 'legal.privacy', icon: 'user' },
  { key: 'responsible', labelKey: 'legal.responsible', icon: 'warn' },
  { key: 'fairness', labelKey: 'legal.fairness', icon: 'chart' },
  { key: 'rules', labelKey: 'legal.rules', icon: 'info' },
  { key: 'help', labelKey: 'legal.help', icon: 'chat' },
  { key: 'security', labelKey: 'legal.security', icon: 'shield' },
];

export async function render(root, ctx) {
  const forced = ctx.tab === '404' ? '404' : null;
  if (forced === '404') return notFound(root);
  if (ctx.path === '/fairness') return fairness(root, ctx);
  const key = ctx.params.doc || 'terms';
  let doc = null;
  try { doc = await api.cached(`/legal/${key}?locale=${locale()}`, 60000); } catch (err) {
    paint(root, html`<div class="container container--narrow"><div class="panel"><div class="panel__body empty">
      <h2>${t(err?.code || 'err.doc_missing')}</h2><p class="section__sub">${t('info.doc_missing_body')}</p>
      <a class="btn btn--gold" href="/legal/terms" data-link>${t('legal.terms')}</a></div></div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  paint(root, html`
    <div class="container container--wide">
      <div class="layout-lobby">
        <aside class="layout-lobby__side" aria-label="${t('info.docs')}">
          <nav class="panel"><div class="panel__body panel__body--tight stack" style="gap:2px">
            ${DOCS.map((d) => html`
              <a class="row" href="/legal/${d.key}" data-link aria-current="${String(d.key === key)}"
                style="padding:9px 10px;border-radius:10px;${d.key === key ? 'background:var(--panel-2);color:var(--gold-light)' : 'color:var(--text-dim)'}">
                ${icon(d.icon, 16)}<span data-i18n="${d.labelKey}">${t(d.labelKey)}</span></a>`)}
            <hr />
            <a class="row" href="/responsible" data-link style="padding:9px 10px">${icon('cog', 16)}<span>${t('info.my_limits')}</span></a>
            <a class="row" href="/support" data-link style="padding:9px 10px">${icon('chat', 16)}<span>${t('nav.support')}</span></a>
          </div></nav>
        </aside>
        <article>
          <div class="section__head">
            <div class="grow"><h1 class="section__title">${doc.title}</h1>
              <p class="section__sub">${t('info.version')}: ${doc.version} · ${t('info.effective')}: ${fmtDateTime(doc.effective)}</p></div>
            <span class="chip chip--soft">${doc.locale === 'bn' ? 'বাংলা' : 'English'}</span>
          </div>
          <div class="panel"><div class="panel__body stack">
            ${demoNotice('compliance.demo_long')}
            ${doc.sections.map((sec, i) => html`
              <section id="sec-${i}" style="scroll-margin-top:80px">
                <h2 style="font-size:1.04rem">${sec.heading}</h2>
                ${sec.paragraphs.map((p) => html`<p style="color:var(--text-dim);font-size:.94rem">${p}</p>`)}
              </section>`)}
            <hr />
            <div class="row row--wrap" style="gap:8px">
              <button class="btn btn--sm" type="button" data-print>${t('btn.print')}</button>
              <a class="btn btn--sm" href="/support" data-link>${t('info.ask_question')}</a>
              <span class="grow"></span>
              <span class="section__sub">${t('info.contact')} ${state.content?.support?.email || 'support@arenaplay.local'}</span>
            </div>
          </div></div>
        </article>
        <aside class="layout-lobby__side stack">
          <section class="panel"><div class="panel__head">${icon('info', 16)}<h3>${t('info.summary')}</h3></div>
            <div class="panel__body stack">
              ${doc.sections.slice(0, 4).map((sec, i) => html`<a href="#sec-${i}" class="row" style="gap:8px;align-items:flex-start;padding:4px 0">
                <span class="chip chip--soft">${fmtNum(i + 1)}</span><span class="grow" style="font-size:.86rem">${sec.heading}</span></a>`)}
            </div></section>
          <section class="panel"><div class="panel__head">${icon('globe', 16)}<h3>${t('info.other_locale')}</h3></div>
            <div class="panel__body">
              <p class="section__sub">${t('info.other_locale_body')}</p>
              <button class="btn btn--sm" type="button" data-lang="${isBengali() ? 'en' : 'bn'}">${isBengali() ? 'English version' : 'বাংলা সংস্করণ'}</button>
            </div></section>
        </aside>
      </div>
    </div>`);
  root.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => {
    const { setLocale } = await import('../core/i18n.js');
    await setLocale(b.dataset.lang);
    api.invalidate('/legal');
    await window.App.render();
  }));
  return () => {};
}

// ---------------------------------------------------------------------------
async function fairness(root, ctx) {
  const authed = !!state.user;
  const data = authed ? await api.get('/fairness').catch(() => null) : null;
  const current = data?.current || {};
  paint(root, html`
    <div class="container container--narrow stack">
      <div class="section__head"><div class="grow"><h1 class="section__title">${t('fairness.title')}</h1>
        <p class="section__sub">${t('fairness.sub')}</p></div>
        <span class="chip chip--gold">${t('app.demo_badge')}</span></div>
      <div class="panel"><div class="panel__body stack">
        <p style="color:var(--text-dim)">${t(data?.explanationKey || 'fairness.explain')}</p>
        <div class="notice notice--info">${icon('info', 18)}<div><code class="mono">${data?.engine || 'HMAC-SHA256'}</code></div></div>
        ${authed ? html`
          <dl class="kv">
            <dt>${t('fairness.server_hash')}</dt><dd class="mono">${current.serverSeedHash || '—'}</dd>
            <dt>${t('fairness.client_seed')}</dt><dd class="mono">${current.clientSeed || 'player'}</dd>
            <dt>${t('fairness.nonce')}</dt><dd>${fmtNum(current.nonce ?? 0)}</dd>
            <dt>${t('fairness.seed_active')}</dt><dd>${current.createdAt ? fmtRelative(current.createdAt) : '—'}</dd>
          </dl>
          <div class="row row--wrap">
            <button class="btn btn--gold" type="button" data-rotate>${t('fairness.rotate')}</button>
            <button class="btn" type="button" data-seed>${t('fairness.set_client_seed')}</button>
            <button class="btn btn--ghost" type="button" data-verify-open>${t('fairness.verify_any')}</button>
          </div>`
        : html`<div class="notice notice--gold">${icon('user', 18)}<div>${t('fairness.login_hint')}
          <a href="/login?next=/fairness" data-link>${t('auth.login')}</a></div></div>`}
      </div></div>

      ${data?.revealed?.length ? html`
        <section class="panel">
          <div class="panel__head">${icon('clock', 16)}<h3>${t('fairness.revealed')}</h3>
            <span class="grow"></span><span class="section__sub">${t('fairness.revealed_sub')}</span></div>
          <div class="panel__body">
                    ${dataTable({
    columns: [
      { labelKey: 'fairness.rotated_at', get: (r) => r.rotated_at ? fmtRelative(r.rotated_at) : fmtRelative(r.created_at) },
      { labelKey: 'fairness.server_seed', get: (r) => { const txt = r.revealed ? `${String(r.server_seed || '').slice(0, 22)}…` : t('fairness.not_revealed'); return html`<span class="mono">${txt}</span>`; } },
      { labelKey: 'fairness.client_seed', key: 'client_seed' },
      { labelKey: 'fairness.nonce', key: 'nonce', num: true },
    ],
    rows: (data.revealed || []).slice(0, 8),
    emptyKey: 'fairness.none',
  })}
          </div>
        </section>` : ''}

      <section class="panel">
        <div class="panel__head">${icon('shield', 16)}<h3>${t('fairness.how_title')}</h3></div>
        <div class="panel__body grid-2">
          ${['fairness.step_1', 'fairness.step_2', 'fairness.step_3', 'fairness.step_4'].map((k, i) => html`
            <div><h3 style="font-size:.96rem">${fmtNum(i + 1)}. ${t(`fairness.step_h${i + 1}`)}</h3>
              <p class="section__sub">${t(k)}</p></div>`)}
        </div>
      </section>
      <a class="btn btn--ghost" href="/legal/fairness" data-link>${t('btn.read_methodology')}${icon('arrow', 15)}</a>
    </div>`);

  root.querySelector('[data-rotate]')?.addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try { const r = await api.post('/fairness/rotate'); toastOk(t('fairness.rotated')); api.invalidate('/fairness'); await render(root, ctx); }
    catch (err) { toastError(err); } finally { ev.currentTarget.disabled = false; }
  });
  root.querySelector('[data-seed]')?.addEventListener('click', async () => {
    const value = prompt(t('fairness.seed_prompt'), current.clientSeed || 'player');
    if (value === null) return;
    try { await api.post('/fairness/client-seed', { clientSeed: value }); toastOk(t('fairness.seed_saved')); api.invalidate('/fairness'); await render(root, ctx); }
    catch (err) { toastError(err); }
  });
  root.querySelector('[data-verify-open]')?.addEventListener('click', () => verifyByReference());
  return () => {};
}

async function verifyByReference() {
  const wrap = document.createElement('div');
  paint(wrap, html`
    <div class="stack">
      <div class="field"><label class="field__label" for="bet-ref">${t('fairness.bet_ref')}</label>
        <div class="input-group"><input class="input" id="bet-ref" placeholder="mvcly2mx…" autocomplete="off" />
          <button class="btn btn--gold" type="button" data-go>${t('btn.verify')}</button></div>
        <span class="field__hint">${t('fairness.bet_ref_hint')}</span></div>
      <div data-role=out></div>
    </div>`);
  modal({ title: t('fairness.verify_any'), body: wrap, wide: true });
  const out = wrap.querySelector('[data-role=out]');
  const go = async () => {
    const id = wrap.querySelector('#bet-ref').value.trim();
    if (!id) { toast(t('fairness.need_ref')); return; }
    paint(out, html`<div class="row"><span class="spinner"></span><span class="section__sub">${t('fairness.computing')}</span></div>`);
    try {
      const v = await api.get(`/fairness/verify/${encodeURIComponent(id)}`);
      paint(out, verificationHtml(v));
    } catch (err) {
      paint(out, html`<div class="notice notice--warn">${icon('warn', 18)}<div>${t(err?.code || 'err.verify_failed', err?.params || {})}</div></div>`);
    }
  };
  wrap.querySelector('[data-go]').addEventListener('click', go);
  wrap.querySelector('#bet-ref').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
}

function notFound(root) {
  paint(root, html`
    <div class="container container--narrow">
      <div class="panel"><div class="panel__body empty">
        <span class="empty__icon">🧭</span>
        <h1 style="font-size:2.6rem;margin:0">404</h1>
        <p class="section__sub">${t('err.404_body')}</p>
        <div class="row row--wrap" style="justify-content:center">
          <a class="btn btn--gold" href="/" data-link>${t('btn.back_home')}</a>
          <a class="btn" href="/casino" data-link>${t('nav.casino')}</a>
          <a class="btn" href="/support" data-link>${t('nav.support')}</a>
        </div>
      </div></div>
    </div>`);
  return () => {};
}

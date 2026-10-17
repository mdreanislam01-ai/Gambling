/** Login / register / password reset. Same rules as the server, errors inline. */
import { html, render as paint, icon } from '../core/dom.js';
import { t, isBengali, fmtCredits } from '../core/i18n.js';
import { api } from '../core/api.js';
import { state, patch, refreshSession, refreshWallet, refreshFavorites, refreshNotifications } from '../core/state.js';
import { navigate } from '../app.js';
import { toast, toastOk, toastError, modal } from '../core/ui.js';
import { buildForm, passwordIssues, passwordStrength, emailOk, usernameOk } from '../forms.js';
import { setLocale, locale } from '../core/i18n.js';

const MODES = { '/login': 'login', '/register': 'register', '/forgot-password': 'forgot', '/reset-password': 'reset' };

export async function render(root, ctx) {
  const mode = MODES[ctx.path] || (ctx.params.mode) || 'login';
  const devHelper = state.boot?.env === 'development';
  const content = state.content || {};
  const registrationOpen = content.flags?.registrationOpen !== false;

  const shell = (titleKey, subKey, body, aside) => html`
    <div class="container container--narrow">
      <div class="hero" style="padding:0;border-radius:var(--radius-lg)">
        <div class="hero__inner">
          <span class="chip chip--gold">${t('app.demo_badge')}</span>
          <h1>${t(titleKey)}</h1>
          <p class="hero__lead">${t(subKey)}</p>
        </div>
      </div>
      <div class="grid-2" style="margin-top:14px;align-items:start">
        <section class="panel"><div class="panel__body" data-role="form"></div></section>
        ${aside}
      </div>
    </div>`;

  const perks = html`
    <aside class="stack">
      <section class="panel">
        <div class="panel__head">${icon('gift', 17)}<h3>${t('auth.perks')}</h3></div>
        <div class="panel__body stack">
          <ul class="col" style="gap:8px;list-style:none;padding:0;margin:0">
            ${['auth.perk_1', 'auth.perk_2', 'auth.perk_3', 'auth.perk_4'].map((k) => html`
              <li class="row" style="align-items:flex-start"><span style="color:var(--green)">${icon('check', 16)}</span><span data-i18n="${k}">${t(k)}</span></li>`)}
          </ul>
          <div class="notice notice--info">${icon('info', 18)}<div>${t('compliance.demo_short')}</div></div>
        </div>
      </section>
      ${devHelper && (mode === 'login' || mode === 'register') ? html`
        <section class="panel">
          <div class="panel__head">${icon('user', 17)}<h3>${t('auth.demo_accounts')}</h3></div>
          <div class="panel__body stack">
            <p class="section__sub">${t('auth.demo_accounts_note')}</p>
            <div class="list-divided">
              ${[
                { id: 'demo_player', pw: 'DemoUser!2026', role: 'player' },
                { id: 'raki_bd', pw: 'DemoUser!2026', role: 'player' },
                { id: 'arenaplay_admin', pw: 'ChangeMe_Admin!2026', role: 'admin' },
              ].map((a) => html`
                <div class="row" style="gap:8px">
                  <div class="grow"><code>${a.id}</code><div class="card__meta">${t(`user.role.${a.role}`)}</div></div>
                  <button class="btn btn--sm" type="button" data-fill="${a.id}|${a.pw}">${t('btn.use')}</button>
                </div>`)}
            </div>
          </div>
        </section>` : ''}
    </aside>`;

  if (mode === 'login') {
    paint(root, shell('auth.login_title', 'auth.login_sub', '', perks));
    const form = buildForm(root.querySelector('[data-role=form]'), {
      submitKey: 'auth.login',
      layout: '',
      fields: [
        { name: 'identifier', labelKey: 'field.identifier', type: 'email', required: true, autocomplete: 'username', wide: true, hintKey: 'field.identifier_hint' },
        { name: 'password', labelKey: 'field.password', type: 'password', required: true, autocomplete: 'current-password', wide: true },
      ],
      extra: html`
        <div class="row row--between" style="grid-column:1/-1;flex-wrap:wrap">
          <a href="/forgot-password" data-link class="section__sub">${t('auth.forgot_link')}</a>
          <span class="section__sub">${t('auth.session_hint')}</span>
        </div>
        <div class="row row--wrap" style="grid-column:1/-1;gap:8px">
          <span class="section__sub">${t('auth.no_account')}</span>
          <a class="btn btn--sm" href="/register" data-link ${registrationOpen ? '' : 'aria-disabled="true"'}>${t('auth.register')}</a>
          <button class="btn btn--sm btn--ghost" type="button" data-lang="${isBengali() ? 'en' : 'bn'}">${isBengali() ? 'English' : 'বাংলা'}</button>
        </div>`,
      onSubmit: async (data) => {
        const r = await api.post('/auth/login', data);
        await afterAuth(r);
        toastOk(t('auth.welcome_back', { name: r.user.displayName || r.user.username }));
      },
    });
    wireExtras(root, form);
    return;
  }

  if (mode === 'register') {
    if (!registrationOpen) {
      paint(root, html`<div class="container container--narrow"><div class="panel"><div class="panel__body empty">
        <h2>${t('err.registration_closed')}</h2><p class="section__sub">${t('err.registration_closed_body')}</p>
        <a class="btn btn--gold" href="/login" data-link>${t('auth.login')}</a></div></div></div>`);
      return;
    }
    paint(root, shell('auth.register_title', 'auth.register_sub', '', perks));
    const form = buildForm(root.querySelector('[data-role=form]'), {
      submitKey: 'auth.create_account',
      fields: [
        { name: 'email', labelKey: 'field.email', type: 'email', required: true, autocomplete: 'email' },
        { name: 'username', labelKey: 'field.username', type: 'username', required: true, autocomplete: 'username' },
        { name: 'password', labelKey: 'field.password', type: 'password', required: true, autocomplete: 'new-password' },
        { name: 'confirm', labelKey: 'field.confirm_password', type: 'password', required: true, autocomplete: 'new-password',
          validate: (v, all) => (v === all.password ? null : 'val.password_mismatch') },
        { name: 'locale', labelKey: 'field.language', type: 'select', options: [{ value: 'en', labelKey: 'lang.en' }, { value: 'bn', labelKey: 'lang.bn' }], required: true },
        { name: 'referral', labelKey: 'field.referral', required: false, hintKey: 'field.referral_hint' },
        { name: 'confirmAge', labelKey: 'auth.confirm_age', type: 'checkbox', required: true },
        { name: 'acceptTerms', labelKey: 'auth.accept_terms', type: 'checkbox', required: true },
      ],
      values: { locale: locale() },
      extra: html`
        <div class="notice notice--gold" style="grid-column:1/-1">${icon('gift', 18)}
          <div><strong>${t('auth.bonus_title')}</strong> — ${t('auth.bonus_body', { amount: fmtCredits(content.demo?.signupBonus || 0) })}
          <div class="section__sub">${t('auth.bonus_note')}</div></div>
        </div>
        <div class="row" style="grid-column:1/-1;gap:8px;align-items:flex-start">
          <span class="section__sub grow">${t('auth.terms_link_pre')}</span>
          <a class="chip chip--soft" href="/legal/terms" data-link>${t('legal.terms')}</a>
          <a class="chip chip--soft" href="/legal/privacy" data-link>${t('legal.privacy')}</a>
          <a class="chip chip--soft" href="/legal/responsible" data-link>${t('legal.responsible')}</a>
        </div>
        <div class="row" style="grid-column:1/-1;gap:8px">
          <span class="section__sub">${t('auth.have_account')}</span>
          <a class="btn btn--sm" href="/login" data-link>${t('auth.login')}</a>
        </div>
`,
      onSubmit: async (data) => {
        const { confirm, ...rest } = data;
        const r = await api.post('/auth/register', rest);
        await afterAuth(r, true);
        toastOk(t('auth.account_created'));
      },
    });
    wireExtras(root, form);
    return;
  }

  if (mode === 'forgot') {
    paint(root, shell('auth.forgot_title', 'auth.forgot_sub', '', html`
      <aside class="stack">
        <section class="panel"><div class="panel__head">${icon('info', 17)}<h3>${t('auth.forgot_how')}</h3></div>
          <div class="panel__body stack">
            <ol class="col" style="gap:6px;padding-left:18px;margin:0">
              <li data-i18n="auth.forgot_step1">${t('auth.forgot_step1')}</li>
              <li data-i18n="auth.forgot_step2">${t('auth.forgot_step2')}</li>
              <li data-i18n="auth.forgot_step3">${t('auth.forgot_step3')}</li>
            </ol>
            ${devHelper ? html`<button class="btn btn--sm" type="button" data-open-mailbox>${t('auth.open_mailbox')}</button>` : ''}
            <div class="notice notice--warn">${icon('warn', 18)}<div>${t('auth.forgot_support')}</div></div>
          </div></section>
      </aside>`));
    const form = buildForm(root.querySelector('[data-role=form]'), {
      submitKey: 'auth.send_reset',
      layout: '',
      fields: [{ name: 'email', labelKey: 'field.email', type: 'email', required: true, autocomplete: 'email', wide: true }],
      onSubmit: async (data) => {
        const r = await api.post('/auth/forgot', data);
        toastOk(t(r.code || 'auth.reset_requested'));
        paint(root.querySelector('[data-role=form]'), html`
          <div class="stack">
            <div class="notice notice--info">${icon('check', 18)}<div><strong>${t('auth.reset_sent')}</strong>
              <div class="section__sub">${t('auth.reset_sent_body', { email: data.email })}</div></div></div>
            ${devHelper ? html`
              <div class="notice notice--gold">${icon('gift', 18)}<div>${t('dev.mailbox_note')}</div></div>
              <button class="btn btn--gold btn--block" type="button" data-fetch-mail>${t('auth.fetch_link')}</button>
              <div data-role="mail-list"></div>` : ''}
            <a class="btn btn--ghost" href="/login" data-link>${t('auth.back_to_login')}</a>
          </div>`);
        root.querySelector('[data-fetch-mail]')?.addEventListener('click', async () => {
          try {
            const m = await api.get(`/dev/mailbox/${encodeURIComponent(data.email)}`);
            const list = root.querySelector('[data-role=mail-list]');
            const links = (m.rows || []).flatMap((row) => [
              ...(String(row.body || '').match(/\/reset-password\?token=[a-f0-9]{6,}/g) || []),
            ]);
            paint(list, html`
              <div class="list-divided">
                ${(m.rows || []).map((row) => html`
                  <div><div class="card__meta">${t('auth.mail_subject')}: <strong>${row.subject}</strong> · ${row.createdAt}</div>
                    ${(String(row.body || '').match(/\/reset-password\?token=[a-f0-9]{6,}/g) || []).map((l) => html`
                      <a class="btn btn--sm btn--gold" style="margin-top:6px" href="${l}" data-link>${t('auth.open_reset')}</a>`)}
                  </div>`)}
                ${!links.length ? html`<p class="section__sub">${t('dev.mailbox_empty')}</p>` : ''}
              </div>`);
          } catch (err) { toastError(err); }
        });
      },
    });
    wireExtras(root, form);
    root.querySelector('[data-open-mailbox]')?.addEventListener('click', async () => {
      try {
        const m = await api.get('/dev/mailbox/');
        paint(document.createElement('div'), '');
        modal({ title: t('auth.mailbox'), body: html`<pre class="mono" style="white-space:pre-wrap">${JSON.stringify(m.rows || [], null, 2).slice(0, 2000)}</pre>` });
      } catch (err) { toastError(err); }
    });
    return;
  }

  // reset
  const token = ctx.query.token || '';
  paint(root, shell('auth.reset_title', 'auth.reset_sub', '', html`
    <aside class="stack"><section class="panel"><div class="panel__head">${icon('shield', 17)}<h3>${t('auth.reset_rules')}</h3></div>
      <div class="panel__body"><ul class="col" style="gap:6px;padding-left:18px;margin:0">
        ${['sec.pw_short', 'sec.pw_lower', 'sec.pw_upper', 'sec.pw_digit', 'sec.pw_symbol'].map((k) => html`<li class="section__sub" data-i18n="${k}">${t(k)}</li>`)}
      </ul></div></section></aside>`));
  const form = buildForm(root.querySelector('[data-role=form]'), {
    submitKey: 'auth.set_password',
    layout: '',
    fields: [
      { name: 'token', labelKey: 'field.reset_token', required: !!token, type: token ? 'text' : 'text', wide: true, autocomplete: 'one-time-code', readonly: !token },
      { name: 'password', labelKey: 'field.new_password', type: 'password', required: true, wide: true, autocomplete: 'new-password' },
      { name: 'confirm', labelKey: 'field.confirm_password', type: 'password', required: true, wide: true, autocomplete: 'new-password',
        validate: (v, all) => (v === all.password ? null : 'val.password_mismatch') },
    ],
    values: { token },
    onSubmit: async (data) => {
      await api.post('/auth/reset', { token: data.token, password: data.password });
      toastOk(t('auth.password_updated'));
      navigate('/login');
    },
  });
  if (!token) {
    const note = document.createElement('p');
    note.className = 'section__sub';
    note.textContent = t('auth.token_hint');
    root.querySelector('[data-role=form]')?.prepend(note);
  }
  wireExtras(root, form);
}

/** Shared wiring: demo-account quick fill. Language switching and internal
 * links are handled by the shell's document-level delegation. */
function wireExtras(root, form) {
  for (const b of root.querySelectorAll('[data-fill]')) {
    b.addEventListener('click', () => {
      const [id, pw] = b.dataset.fill.split('|');
      const host = root.querySelector('[data-role=form]');
      const ident = host.querySelector('[name=identifier]') || host.querySelector('[name=email]');
      const pass = host.querySelector('[name=password]');
      if (ident) ident.value = id;
      if (pass) pass.value = pw;
      form?.patchValues?.({ identifier: id, email: id.includes('@') ? id : '', password: pw, confirm: pw });
      form?.clearErrors?.();
      toast(t('auth.demo_filled'));
      setTimeout(() => host.querySelector('[data-role=submit]')?.focus(), 30);
    });
  }
}

async function afterAuth(r, isNew = false) {
  patch({ user: r.user, wallet: r.wallet || null, csrf: r.csrf || null }, 'session');
  api.setCsrf(r.csrf);
  try { await refreshSession(); } catch { /* boot payload already applied */ }
  await Promise.all([refreshNotifications().catch(() => {}), refreshFavorites().catch(() => {})]);
  const next = new URL(location.href).searchParams.get('next');
  const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : (isNew ? '/account' : '/');
  navigate(safe, { replace: true });
}

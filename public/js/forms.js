/**
 * Schema-driven forms. Deliberately DOM-light: `validators`, `passwordStrength`
 * and `coerce` are pure so `node --test` can exercise the same rules the browser
 * shows — the server enforces the identical policy.
 */
import { html, render, icon } from './core/dom.js';
import { t, isBengali } from './core/i18n.js';

export const emailOk = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()) && v.length <= 190;
export const usernameOk = (v) => typeof v === 'string' && /^[a-z0-9_.]{3,24}$/i.test(v.trim());
export const required = (v) => v !== undefined && v !== null && String(v).trim() !== '';

/** Mirrors src/lib/security.js passwordIssues(). */
export function passwordIssues(pw) {
  const s = String(pw ?? '');
  const out = [];
  if (s.length < 10) out.push('sec.pw_short');
  if (s.length > 200) out.push('sec.pw_long');
  if (!/[a-z]/.test(s)) out.push('sec.pw_lower');
  if (!/[A-Z]/.test(s)) out.push('sec.pw_upper');
  if (!/[0-9]/.test(s)) out.push('sec.pw_digit');
  if (/^(password|123456|qwerty|letmein|welcome)/i.test(s)) out.push('sec.pw_common');
  if (/^\s|\s$/.test(s)) out.push('sec.pw_space');
  if (s.length >= 10 && !/[^A-Za-z0-9\s]/.test(s)) out.push('sec.pw_symbol');
  return [...new Set(out)];
}

export function passwordStrength(pw) {
  const s = String(pw ?? '');
  let score = 0;
  if (s.length >= 10) score += 1;
  if (s.length >= 14) score += 1;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score += 1;
  if (/[0-9]/.test(s)) score += 1;
  if (/[^A-Za-z0-9]/.test(s)) score += 1;
  if (passwordIssues(s).length) score = Math.min(score, 2);
  return Math.max(0, Math.min(4, score - 1));
}

export const coerce = (type, value) => {
  if (type === 'checkbox') return !!value;
  if (type === 'number') {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'cents') {
    if (value === '' || value === null) return null;
    const n = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return typeof value === 'string' ? value.trim() : value ?? '';
};

/** Pure validation pass: returns { field: errorKey }. */
export function validateSchema(schema, data) {
  const errors = {};
  for (const f of schema) {
    const value = data[f.name];
    if (f.required && (value === null || value === undefined || value === '' || (f.type === 'checkbox' && !value))) {
      errors[f.name] = f.type === 'checkbox' ? 'val.required_accept' : 'val.required';
      continue;
    }
    if (value === '' || value === null || value === undefined) continue;
    if (f.type === 'email' && !emailOk(value)) errors[f.name] = 'val.email';
    else if (f.type === 'username' && !usernameOk(value)) errors[f.name] = 'val.username';
    else if (f.type === 'password') {
      const issues = passwordIssues(value);
      if (issues.length) errors[f.name] = issues[0];
    } else if (f.min !== undefined && (f.type === 'number' || f.type === 'cents') && value < f.min) errors[f.name] = f.errorKey || 'val.min';
    else if (f.max !== undefined && (f.type === 'number' || f.type === 'cents') && value > f.max) errors[f.name] = f.errorKey || 'val.max';
    else if (f.min && (typeof value === 'string') && value.length < f.min) errors[f.name] = 'val.too_short';
    else if (f.validate) {
      const res = f.validate(value, data);
      if (res) errors[f.name] = res;
    }
  }
  return errors;
}

export const strengthLabel = (n) => t(['sec.pw_weak', 'sec.pw_fair', 'sec.pw_good', 'sec.pw_strong'][n] || 'sec.pw_fair');

/**
 * buildForm(container, { fields, values, submitKey, onSubmit, onSuccess })
 * Returns a handle with .data(), .setErrors(), .setBusy(), .focusFirst().
 */
export function buildForm(host, { fields, values = {}, submitKey = 'btn.submit', variant = 'gold', onSubmit, onSuccess, extra = '', layout = 'form-grid--2' }) {
  const data = { ...values };
  const errors = {};
  let busy = false;
  const nameOf = (f) => `f-${Math.random().toString(36).slice(2, 8)}`;
  const ids = new Map(fields.map((f) => [f.name, nameOf(f)]));

  const fieldHtml = (f) => {
    const id = ids.get(f.name);
    const v = data[f.name];
    const label = html`<label class="field__label" for="${id}">${f.labelKey ? t(f.labelKey) : f.label}${f.required ? html` <span style="color:var(--red)">*</span>` : ''}</label>`;
    if (f.type === 'checkbox') {
      return html`
        <div class="field" style="grid-column:1/-1">
          <label class="check" for="${id}">
            <input id="${id}" type="checkbox" name="${f.name}" ${v ? 'checked' : ''} />
            <span>${f.labelKey ? t(f.labelKey) : f.label}${f.required ? html` <span style="color:var(--red)">*</span>` : ''}</span>
          </label>
          <div class="field__error" data-err="${f.name}" role="alert"></div>
        </div>`;
    }
    if (f.type === 'select' || f.options) {
      return html`
        <div class="field" style="${f.wide ? 'grid-column:1/-1' : ''}">
          ${label}
          <select class="select" id="${id}" name="${f.name}">
            ${f.placeholderKey ? html`<option value="" ${!v ? 'selected' : ''}>${t(f.placeholderKey)}</option>` : ''}
            ${(f.options || []).map((o) => html`<option value="${o.value}" ${String(o.value) === String(v ?? '') ? 'selected' : ''}>${o.labelKey ? t(o.labelKey) : o.label}</option>`)}
          </select>
          ${f.hintKey ? html`<span class="field__hint">${t(f.hintKey)}</span>` : ''}
          <div class="field__error" data-err="${f.name}" role="alert"></div>
        </div>`;
    }
    if (f.type === 'textarea') {
      return html`
        <div class="field" style="grid-column:1/-1">
          ${label}
          <textarea class="textarea" id="${id}" name="${f.name}" rows="${f.rows || 4}" maxlength="${f.maxLen || 4000}"
            ${f.placeholderKey ? `placeholder="${t(f.placeholderKey)}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>${v ?? ''}</textarea>
          ${f.hintKey ? html`<span class="field__hint">${t(f.hintKey)}</span>` : ''}
          <div class="field__error" data-err="${f.name}" role="alert"></div>
        </div>`;
    }
    const inputType = f.type === 'password' ? 'password' : f.type === 'number' || f.type === 'cents' ? 'number' : f.type === 'email' ? 'email' : f.type === 'date' ? 'date' : 'text';
    return html`
      <div class="field" style="${f.wide ? 'grid-column:1/-1' : ''}">
        ${label}
        <div class="input-group">
          <input class="input" id="${id}" name="${f.name}" type="${inputType}"
            inputmode="${f.type === 'number' || f.type === 'cents' ? 'decimal' : f.type === 'email' ? 'email' : 'text'}"
            value="${v ?? ''}" ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}
            ${f.min !== undefined && (f.type === 'number' || f.type === 'cents') ? `min="${f.min}"` : ''}
            ${f.max !== undefined && (f.type === 'number' || f.type === 'cents') ? `max="${f.max}"` : ''}
            ${f.step ? `step="${f.step}"` : f.type === 'cents' ? 'step="0.01"' : ''}
            ${f.maxLen ? `maxlength="${f.maxLen}"` : ''}
            ${f.readonly ? 'readonly' : ''}
            ${f.placeholderKey ? `placeholder="${t(f.placeholderKey)}"` : ''} />
          ${f.type === 'password' ? html`<button class="btn btn--sm" type="button" data-act="peek" aria-label="${t('a11y.show_password')}">${icon('info', 14)}</button>` : ''}
          ${f.suffixKey ? html`<span class="suffix">${t(f.suffixKey)}</span>` : ''}
        </div>
        ${f.type === 'password' ? html`<div class="meter" style="margin-top:6px"><span data-role="pw-meter" style="width:0%"></span></div>
          <span class="field__hint" data-role="pw-hint">${t('sec.pw_rules')}</span>` : ''}
        ${f.hintKey ? html`<span class="field__hint">${t(f.hintKey)}</span>` : ''}
        <div class="field__error" data-err="${f.name}" role="alert"></div>
      </div>`;
  };

  paint();
  function paint() {
    render(host, html`
      <form class="stack" novalidate autocomplete="on">
        <div class="form-grid ${layout}">
          ${fields.map(fieldHtml)}
          ${extra}
        </div>
        <div class="field__error" data-err="__form" role="alert" aria-live="assertive"></div>
        <button class="btn btn--${variant} btn--block btn--lg" type="submit" data-role="submit" ${busy ? 'disabled' : ''}>
          ${busy ? html`<span class="spinner" aria-hidden="true"></span>` : ''}<span>${t(submitKey)}</span>
        </button>
      </form>`);
    wire();
    applyErrors();
  }

  function wire() {
    const form = host.querySelector('form');
    form.addEventListener('input', (ev) => {
      const input = ev.target;
      if (!input.name) return;
      data[input.name] = coerce(fieldType(input.name), input.type === 'checkbox' ? input.checked : input.value);
      if (fieldType(input.name) === 'password') {
        const s = passwordStrength(String(input.value || ''));
        const meter = host.querySelector('[data-role=pw-meter]');
        if (meter) meter.style.width = `${(s + 1) * 25}%`;
        const hint = host.querySelector('[data-role=pw-hint]');
        if (hint) hint.textContent = `${t('sec.pw_strength')}: ${strengthLabel(s)} · ${passwordIssues(input.value).map((k) => t(k)).join(' · ') || t('sec.pw_ok')}`;
      }
      if (errors[input.name]) { delete errors[input.name]; applyErrors(); }
    });
    form.addEventListener('change', (ev) => {
      if (ev.target.name) data[ev.target.name] = coerce(fieldType(ev.target.name), ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value);
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const found = validateSchema(fields, readData());
      Object.assign(errors, found);
      for (const f of fields) if (!found[f.name]) delete errors[f.name];
      applyErrors();
      if (Object.keys(errors).filter((k) => !k.startsWith('__')).length) { focusFirst(); return; }
      setBusy(true);
      try {
        const res = await onSubmit?.(readData(), handle);
        if (res !== false) onSuccess?.(res);
      } catch (err) {
        handle.setServerErrors(err);
      } finally {
        setBusy(false);
      }
    });
    host.querySelectorAll('[data-act=peek]').forEach((b) => b.addEventListener('click', () => {
      const input = b.closest('.input-group').querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      b.setAttribute('aria-label', t(input.type === 'password' ? 'a11y.show_password' : 'a11y.hide_password'));
    }));
  }

  const fieldType = (name) => fields.find((f) => f.name === name)?.type || 'text';
  function readData() {
    const out = {};
    for (const f of fields) out[f.name] = coerce(f.type, data[f.name] === undefined ? (values[f.name] ?? '') : data[f.name]);
    return out;
  }
  function applyErrors() {
    for (const f of fields) {
      const node = host.querySelector(`[data-err="${f.name}"]`);
      const input = host.querySelector(`[name="${f.name}"]`);
      const key = errors[f.name];
      if (node) node.textContent = key ? t(key, { min: f.min, max: f.max, field: f.labelKey ? t(f.labelKey) : f.label }) : '';
      if (input) input.setAttribute('aria-invalid', key ? 'true' : 'false');
    }
    const formErr = host.querySelector('[data-err="__form"]');
    if (formErr) formErr.textContent = errors.__form ? t(errors.__form.key || 'err.form', errors.__form.params || {}) : '';
  }
  function setBusy(flag) {
    busy = flag;
    const btn = host.querySelector('[data-role=submit]');
    if (btn) {
      btn.disabled = flag;
      render(btn, flag ? html`<span class="spinner" aria-hidden="true"></span><span>${t('btn.please_wait')}</span>` : html`<span>${t(submitKey)}</span>`);
    }
  }
  const handle = {
    el: host,
    data: readData,
    set(name, value) { data[name] = value; paint(); },
    patchValues(v) { Object.assign(data, v); paint(); },
    setErrors(map) { Object.assign(errors, map); applyErrors(); },
    setFormError(key, params) { errors.__form = { key, params }; applyErrors(); },
    clearErrors() { for (const k of Object.keys(errors)) delete errors[k]; applyErrors(); },
    /** Maps an ApiError from the server onto the fields (server returns field codes). */
    setServerErrors(err) {
      for (const k of Object.keys(errors)) delete errors[k];
      if (err?.code === 'val.failed' && Array.isArray(err.params?.errors)) {
        for (const e of err.params.errors) if (e.field) errors[e.field] = e.code;
      } else if (err?.isApiError) {
        if (err.params?.field) errors[err.params.field] = err.code;
        else errors.__form = { key: err.code, params: err.params };
      } else {
        errors.__form = { key: 'err.network' };
      }
      applyErrors();
      focusFirst();
      return handle;
    },
    focusFirst() {
      const firstBad = fields.find((f) => errors[f.name]);
      const target = host.querySelector(`[name="${firstBad?.name || fields[0]?.name}"]`);
      target?.focus?.();
    },
    setBusy,
    submit: () => host.querySelector('form')?.requestSubmit(),
    repaint: paint,
  };
  return handle;
}

/** Shared password + legal consent block used by register and reset. */
export const termsCheckbox = (checked) => html`
  <label class="check" style="grid-column:1/-1">
    <input type="checkbox" name="acceptTerms" ${checked ? 'checked' : ''} />
    <span data-i18n="auth.accept_terms">${t('auth.accept_terms')}</span>
  </label>`;

export const ageCheckbox = (checked) => html`
  <label class="check" style="grid-column:1/-1">
    <input type="checkbox" name="confirmAge" ${checked ? 'checked' : ''} />
    <span data-i18n="auth.confirm_age">${t('auth.confirm_age')}</span>
  </label>`;

export const honeypot = () => html`
  <div class="sr-only" aria-hidden="true">
    <label for="website-input">website</label>
    <input id="website-input" name="website" type="text" tabindex="-1" autocomplete="off" />
  </div>`;

export const formNote = (key, params) => html`<p class="section__sub" style="grid-column:1/-1">${t(key, params)}</p>`;
export const isRtl = () => false; // reserved: both supported languages are LTR

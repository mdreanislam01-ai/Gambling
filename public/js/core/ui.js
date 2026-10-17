/** Shared UI services: toasts, modals, timers, loading bar, async guards. */
import { html, render, icon, qs } from './dom.js';
import { t, translateTree, translateErrors } from './i18n.js';

const toastRegion = () => qs('#toast-region');
let toastSeq = 0;

export function toast(message, { type = 'info', duration = 4200, key = null, params } = {}) {
  const region = toastRegion();
  if (!region) return null;
  const id = `toast-${++toastSeq}`;
  const text = key ? t(key, params) : message;
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.id = id;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(node, html`
    <span class="toast__icon">${icon(type === 'success' ? 'check' : type === 'error' ? 'warn' : type === 'warn' ? 'warn' : 'info', 16)}</span>
    <div class="toast__msg">${text}</div>
    <button class="toast__close" type="button" data-act="close" aria-label="${t('a11y.close')}">${icon('close', 14)}</button>`);
  node.addEventListener('click', (ev) => { if (ev.target.closest('[data-act=close]')) dismiss(); });
  region.append(node);
  const timer = setTimeout(dismiss, duration);
  function dismiss() {
    clearTimeout(timer);
    node.style.transition = 'opacity .18s, transform .18s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 200);
  }
  return dismiss;
}
export const toastError = (err, opts) => toast(translateErrors(err), { type: 'error', duration: 6500, ...opts });
export const toastOk = (msg, opts) => toast(msg, { type: 'success', ...opts });

// --- loading bar -----------------------------------------------------------
let barEl = null;
let barTimer = null;
export function progressStart() {
  if (!barEl) {
    barEl = document.createElement('div');
    barEl.className = 'progress-line';
    document.body.append(barEl);
  }
  clearInterval(barTimer);
  barEl.hidden = false;
  let w = 8;
  barEl.style.width = '8%';
  barTimer = setInterval(() => { w = Math.min(88, w + 9); barEl.style.width = `${w}%`; }, 160);
}
export function progressEnd() {
  clearInterval(barTimer);
  if (!barEl) return;
  barEl.style.width = '100%';
  setTimeout(() => { barEl.hidden = true; barEl.style.width = '0%'; }, 220);
}

// --- modal -----------------------------------------------------------------
const modalRoot = () => qs('#modal-root');
let closeStack = [];

/**
 * modal({ title, body, actions, wide, onClose }) — body/actions may be nodes or
 * html`` fragments. Focus is trapped and restored; Escape closes.
 */
export function modal({ title = '', body = '', actions = [], wide = false, dismissible = true, onClose } = {}) {
  const root = modalRoot();
  if (!root) return null;
  const prevFocus = document.activeElement;
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  const box = document.createElement('div');
  box.className = `modal${wide ? ' modal--wide' : ''}`;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', typeof title === 'string' ? title : t('dlg.title'));
  const head = document.createElement('div');
  head.className = 'modal__head';
  render(head, html`<h3 style="margin:0">${title}</h3>${dismissible ? html`<button class="icon-btn" type="button" data-act="close" aria-label="${t('a11y.close')}">${icon('close', 16)}</button>` : ''}`);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'modal__body';
  if (typeof body === 'object' && body.nodeType) bodyEl.append(body);
  else render(bodyEl, body);
  const foot = document.createElement('div');
  foot.className = 'modal__foot';
  if (actions.length) {
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${a.variant ? `btn--${a.variant}` : ''}`;
      btn.innerHTML = a.labelHtml ?? '';
      if (!btn.innerHTML) btn.textContent = a.label || t('btn.close');
      btn.addEventListener('click', async () => {
        if (a.onClick) {
          btn.setAttribute('aria-busy', 'true');
          btn.disabled = true;
          try {
            const keep = await a.onClick({ close, bodyEl, button: btn });
            if (keep === false) return;
          } catch (err) {
            toastError(err);
            return;
          } finally {
            btn.removeAttribute('aria-busy');
            btn.disabled = false;
          }
        }
        close();
      });
      foot.append(btn);
    }
  }
  box.append(head, bodyEl, ...(actions.length ? [foot] : []));
  scrim.append(box);
  scrim.addEventListener('click', (ev) => {
    if (ev.target === scrim && dismissible) close();
    if (ev.target.closest('[data-act=close]')) close();
  });
  root.append(scrim);
  document.body.style.overflow = 'hidden';
  const focusables = () => [...box.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')];
  setTimeout(() => (focusables()[0] || box).focus(), 30);
  const keyHandler = (ev) => {
    if (ev.key === 'Escape' && dismissible) { ev.preventDefault(); close(); }
    if (ev.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      ev.preventDefault();
      f[(i + (ev.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
    }
  };
  document.addEventListener('keydown', keyHandler);
  translateTree(box);
  function close() {
    document.removeEventListener('keydown', keyHandler);
    scrim.remove();
    closeStack = closeStack.filter((x) => x !== close);
    if (!closeStack.length) document.body.style.overflow = '';
    prevFocus?.focus?.();
    onClose?.();
  }
  closeStack.push(close);
  return { close, bodyEl, box };
}

export function confirmDialog({ title, message, confirmKey = 'btn.confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: html`<p>${message}</p>`,
      actions: [
        { label: t('btn.cancel'), onClick: () => { done = true; resolve(false); } },
        { label: t(confirmKey), variant: danger ? 'red' : 'gold', onClick: () => { done = true; resolve(true); return false; } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    const orig = m.close;
    m.close = () => { orig(); };
  });
}

/** Bottom-sheet style drawer used on phones (nav, bet slip). */
export function drawer({ title, body, side = 'left' }) {
  const root = document.body;
  const scrim = document.createElement('div');
  scrim.className = 'drawer-scrim';
  const box = document.createElement('aside');
  box.className = 'drawer';
  if (side === 'right') box.style.cssText = 'inset:0 0 0 auto;border-right:0;border-left:1px solid var(--line);animation:none';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'drawer__title';
  render(head, html`<strong>${title}</strong><button class="icon-btn" type="button" data-act="close" aria-label="${t('a11y.close')}">${icon('close', 16)}</button>`);
  const bodyEl = document.createElement('div');
  bodyEl.className = 'grow';
  if (typeof body === 'object' && body.nodeType) bodyEl.append(body);
  else render(bodyEl, body);
  box.append(head, bodyEl);
  scrim.append(box);
  root.append(scrim);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (ev) => { if (ev.target === scrim || ev.target.closest('[data-act=close]')) close(); });
  translateTree(box);
  setTimeout(() => box.querySelector('a,button')?.focus(), 30);
  return { close, bodyEl };
}

/** Wrap an async UI action: shows a spinner state, funnels errors to toasts. */
export function guard(fn, { busy } = {}) {
  return async (...args) => {
    const btn = busy?.();
    if (btn) { btn.dataset.busy = '1'; btn.disabled = true; }
    progressStart();
    try {
      return await fn(...args);
    } catch (err) {
      if (err?.status === 401) {
        toastError(err);
        window.dispatchEvent(new CustomEvent('app:unauthorized'));
      } else toastError(err);
      throw err;
    } finally {
      progressEnd();
      if (btn) { delete btn.dataset.busy; btn.disabled = false; }
    }
  };
}

/** setInterval that also fires once immediately; returns a stop fn. */
export function every(ms, fn, { immediate = false } = {}) {
  if (immediate) fn();
  const id = setInterval(() => { if (!document.hidden) fn(); }, ms);
  return () => clearInterval(id);
}

/** Countdown loop for "table opens in …" style labels. */
export function countdown(el, targetMs, render_) {
  let raf = 0;
  let timer = 0;
  const tick = () => {
    if (!el.isConnected) { clearInterval(timer); return; }
    render_(el, Math.max(0, targetMs - Date.now()));
    raf = 0;
  };
  timer = setInterval(() => { if (!raf) raf = requestAnimationFrame(tick); }, 250);
  tick();
  return () => { clearInterval(timer); if (raf) cancelAnimationFrame(raf); };
}

export function celebrate(intensity = 1) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#e3b341', '#f7dd9a', '#22c98d', '#4b8bf5'];
  const n = Math.min(46, 14 * intensity);
  for (let i = 0; i < n; i += 1) {
    const bit = document.createElement('i');
    bit.className = 'confetti-bit';
    bit.style.left = `${8 + Math.random() * 84}vw`;
    bit.style.top = '-14px';
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * 0.5}s`;
    bit.style.animationDuration = `${1.1 + Math.random()}s`;
    document.body.append(bit);
    setTimeout(() => bit.remove(), 2600);
  }
}

export const money = (cents) => Number(cents || 0) / 100;
export const debounce = (fn, ms = 250) => {
  let id;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
};
export const clampNum = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

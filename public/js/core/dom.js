/**
 * Tiny DOM helpers. `html` escapes every interpolation by default, so user
 * content (emails, tickets, admin text) can never inject markup. Use raw() to
 * opt in for fragments produced by this app.
 */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
// A raw fragment is a String object that also carries `__raw`. That is what lets
// the same value be interpolated into a tagged template (the fragment is taken
// as-is) and into a plain string template, where a bare `{ __raw }` object would
// have printed "[object Object]" over the panel headers that build their
// `innerHTML` by hand.
const fragment = (markup) => {
  const out = new String(markup);
  out.__raw = markup;
  return out;
};
export const raw = (s) => fragment(String(s ?? ''));

const emit = (v) => {
  if (v === null || v === undefined || v === false || v === true) return '';
  // Nested lists happen for real — a grid built column by column returns an array
  // of arrays — and stringifying one would print "[object Object]" across the
  // board, so recursion is the only honest answer here.
  if (Array.isArray(v)) {
    let joined = '';
    for (let i = 0; i < v.length; i += 1) joined += emit(v[i]);
    return joined;
  }
  if (typeof v === 'object' && v.__raw !== undefined) return v.__raw;
  if (typeof v === 'object') return escapeHtml(v.text ?? JSON.stringify(v));
  return escapeHtml(v);
};

export function html(strings, ...values) {
  let out = '';
  // A plain loop, not forEach: `continue` is only legal inside an iteration
  // statement, and a SyntaxError here would take the whole app down.
  for (let i = 0; i < strings.length; i += 1) {
    out += strings[i];
    if (i >= values.length) continue;
    out += emit(values[i]);
  }
  return { __raw: out };
}
html.isRaw = (v) => !!v && typeof v === 'object' && v.__raw !== undefined;
export const frag = (v) => (v === undefined || v === null ? { __raw: '' } : html.isRaw(v) ? v : { __raw: escapeHtml(v) });

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Replace an element's innerHTML from a tagged template (safe by construction). */
export function render(el, content) {
  if (!el) return null;
  const value = typeof content === 'function' ? content() : content;
  el.innerHTML = value && value.__raw !== undefined ? value.__raw : String(value ?? '');
  return el;
}

/** Event delegation registry: on(el, 'click', '[data-act=x]', handler). */
export function on(el, type, selector, handler, opts = {}) {
  if (typeof selector === 'function') { el.addEventListener(type, selector, opts); return () => el.removeEventListener(type, selector, opts); }
  const listener = (ev) => {
    const target = ev.target.closest(selector);
    if (!target || !el.contains(target)) return;
    handler(ev, target);
  };
  el.addEventListener(type, listener, opts);
  return () => el.removeEventListener(type, listener, opts);
}

export const dataAttrs = (obj) =>
  Object.entries(obj || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${escapeHtml(v)}"`)
    .join(' ');

export function mount(container, node) {
  container.replaceChildren(node);
  return node;
}

export function icon(name, size = 20) {
  const paths = ICONS[name] || ICONS.dot;
  return fragment(`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`);
}

export const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chips: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4 4 4-4 4-4-4z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  dice: '<path d="M4 4h16v16H4z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="9" r="1.4"/><circle cx="15" cy="15" r="1.4"/><circle cx="12" cy="12" r="1.4"/>',
  cards: '<path d="M7 3h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 21h8a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.5 6.5a8 8 0 0 0 0 11m11-11a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  sports: '<path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v18M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  wallet: '<path d="M3 7h13a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="14" r="1.2"/>',
  user: '<circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4 2 5 2 5H4s2-1 2-5Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 19a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  gift: '<path d="M4 10h16v10H4zM4 10 12 5l8 5M12 5v15" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  chart: '<path d="M4 20V9m5 11V4m5 16v-7m5 7V7" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  rocket: '<path d="M12 3c4 2 6 6 6 10l-3 3-6-6 3-7Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 13l-3 3 2 2 2-2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  ticket: '<path d="M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  cog: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" stroke="currentColor" stroke-width="1.4"/>',
  logout: '<path d="M14 4H5v16h9M18 12H9m6-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8"/>',
  check: '<path d="m4 13 5 5L20 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8"/>',
  trophy: '<path d="M8 4h8v4a4 4 0 0 1-8 0zM6 6H4a3 3 0 0 0 3 3m11-3h2a3 3 0 0 1-3 3m-6 5h4m-2 0v4m-4 0h8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  clock: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8v5l3 2" stroke="currentColor" stroke-width="1.6" fill="none"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 11v6M12 7.5v1" stroke="currentColor" stroke-width="1.8"/>',
  warn: '<path d="M12 3 22 20H2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 9v5M12 17v1" stroke="currentColor" stroke-width="1.8"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18" fill="none" stroke="currentColor" stroke-width="1.2"/>',
};

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v.__raw ?? v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [children].flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'object' && child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

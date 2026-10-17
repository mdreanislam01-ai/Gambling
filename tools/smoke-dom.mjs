#!/usr/bin/env node
/**
 * Headless render check: `npm run check:dom`.
 *
 * The SPA has no build step, so a client-side typo is a blank page on a real
 * device and nothing else in the suite would notice: the API answers correctly,
 * the HTML is fine, every import resolves. This boots the real client modules
 * against a DOM, walks the whole router signed out and signed in, switches
 * language, and fails on a page that rendered nothing, printed a raw
 * translation key, leaked "[object Object]", or threw while painting.
 *
 * jsdom is the only thing it needs, and it is optional: without it the check says
 * it was skipped instead of pretending to have passed.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = await import('jsdom'));
} catch {
  console.log('skipped: jsdom is not installed (npm i -D jsdom). Nothing was rendered.');
  process.exit(0);
}

const { bootTestApp } = await import(pathToFileURL(path.join(ROOT, 'tests/helpers/app.js')).href);
const app = await bootTestApp({ engines: true });
const errors = [];

const shell = await fetch(`${app.base}/`, { headers: { accept: 'text/html' } });
const shellHtml = await shell.text();
// jsdom has no canvas: the crash curve asking for a 2D context is the harness,
// not the product, so the notice is filtered while real page errors are kept.
const vc = new VirtualConsole();
vc.on('jsdomError', (err) => { if (!/Not implemented/.test(String(err?.message))) errors.push(`jsdom: ${err?.message}`); });
const dom = new JSDOM(shellHtml, { url: `${app.base}/`, pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
const { window } = dom;
const anything = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : anything),
  apply: () => anything,
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => anything;
window.matchMedia = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.scrollTo = () => {};
window.EventSource = class { addEventListener() {} close() {} };
window.Notification = undefined;
window.URL.createObjectURL = () => 'blob:stub';
window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
window.console = { ...console, error: (...a) => errors.push(`console.error: ${a.map((x) => x?.stack || String(x)).join(' ')}`) };
window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message || e.error}`));
window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.message || e.reason}`));

for (const key of ['window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'matchMedia', 'DOMParser', 'MutationObserver', 'Blob', 'FormData', 'EventSource']) {
  if (window[key] !== undefined) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}

// The client calls fetch('/api/…'); give those the test server and the session.
const nodeFetch = globalThis.fetch;
let sessionCookie = '';
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' && input.startsWith('/') ? app.base + input : input;
  const res = await nodeFetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), ...(sessionCookie ? { cookie: sessionCookie } : {}) },
  });
  // A login issued by the client itself has to carry its session cookie, exactly as
  // a browser would, or the signed-in pass below would silently be a guest pass.
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (set.length) sessionCookie = set[0].split(';')[0];
  return res;
};

const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 15)); };
const client = await import(pathToFileURL(path.join(ROOT, 'public/js/app.js')).href);
const i18n = await import(pathToFileURL(path.join(ROOT, 'public/js/core/i18n.js')).href);
const stateMod = await import(pathToFileURL(path.join(ROOT, 'public/js/core/state.js')).href);

const PAGES = [
  ['/', 'home'],
  ['/casino', 'lobby'],
  ['/casino/slots', 'lobby by category'],
  ['/game/lucky-fruit-3', 'slot play screen'],
  ['/game/european-roulette', 'roulette board'],
  ['/game/classic-blackjack', 'blackjack hand'],
  ['/game/bubble-mines', 'mines grid'],
  ['/game/rocket-crash', 'crash round'],
  ['/game/plinko-rush', 'plinko board'],
  ['/game/lucky-dice', 'dice panel'],
  ['/game/jacks-or-better', 'video poker hand'],
  ['/game/three-patti-showdown', '3-patti table'],
  ['/game/lucky-ball-bingo', 'bingo card'],
  ['/game/live-baccarat', 'live baccarat table'],
  ['/game/live-dream-wheel', 'dream wheel'],
  ['/game/money-drop-wheel', 'wheel options'],
  ['/live', 'live studio'],
  ['/sports', 'sports book'],
  ['/sports/cricket', 'cricket board'],
  ['/login', 'sign in'],
  ['/register', 'register'],
  ['/forgot-password', 'password reset'],
  ['/legal/terms', 'policy document'],
  ['/legal/rules', 'how to play'],
  ['/fairness', 'fairness methodology'],
  ['/account', 'account (signed out)'],
  ['/admin', 'admin (signed out)'],
  ['/404', 'not found'],
];

let failed = 0;
const report = [];

async function walk(pages, { tag, expectBangla }) {
  for (const [route, label] of pages) {
    try {
      // Navigating to the route that is already current is a no-op in the router,
      // which would let the previous language survive into the next pass.
      const same = client.router && client.router.path === route.split('?')[0];
      await client.navigate(same ? `${route}?r=${Math.random().toString(36).slice(2, 6)}` : route);
      await settle();
    } catch (err) {
      errors.push(`${route} threw while navigating: ${err?.stack || err}`);
    }
    const root = window.document.getElementById('app');
    const text = (root?.textContent || '').replace(/\s+/g, ' ').trim();
    const markup = root?.innerHTML || '';
    const min = route.startsWith('/game/') ? 120 : 40;
    const rawKeys = [...markup.matchAll(/>\s*([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){1,4})\s*</g)]
      .map((m) => m[1])
      .filter((k) => /(fairness|game|btn|nav|acc|wallet|admin|rg|sports|live|info|legal|hist|notif|auth|err)\./.test(k));
    const bodyText = window.document.body.textContent.replace(/\s+/g, ' ');
    const leaked = bodyText.match(/.{0,36}(undefined|\[object Object\]|NaN)/)?.[0];
    // Two things show the other language on purpose and must not count as mixing:
    // the EN/বাংলা switcher buttons, and the options of a language picker (each
    // language names itself in its own script). The ৳ symbol is also not a letter.
    const BENGALI = /[\u0985-\u09B9\u09BD-\u09CE\u09DC-\u09DF\u09E0-\u09E3\u09E6-\u09F1]/;
    const probe = root.cloneNode(true);
    for (const n of probe.querySelectorAll('[data-lang], [data-lang-pick], select, .lang-skip')) n.remove();
    for (const n of [...probe.querySelectorAll('*')].filter((e) => e.children.length === 0 && /^(English|\u0985\u09BE\u0982\u09B2\u09BE)( version| \u09b8\u0982\u09b8\u09cd\u0995\u09b0\u09a3)?$/.test(e.textContent.trim()))) n.remove();
    const chromeText = (probe.textContent || '').replace(/\s+/g, ' ');
    const bangla = BENGALI.test(chromeText);
    const problems = [];
    if (text.length < min) problems.push(`only ${text.length} chars rendered`);
    if (rawKeys.length) problems.push(`untranslated keys: ${rawKeys.slice(0, 3).join(', ')}`);
    if (leaked) problems.push(`leaked value: ${leaked.trim()}`);
    if (expectBangla && !bangla) problems.push('no Bangla text while the locale is bn');
    if (!expectBangla && bangla) problems.push(`Bangla leaked into the English pass: ${chromeText.match(/[^ ]*[\u0985-\u09B9][^ ]*/)?.[0] || ''}`);
    if (problems.length) failed += 1;
    report.push(`${problems.length ? 'FAIL' : 'ok  '} ${tag.padEnd(4)} ${route.padEnd(26)} ${String(text.length).padStart(5)} chars  ${problems.length ? problems.join(' | ') : label}`);
  }
}

await client.boot();
await settle();
// Pin the language for the first pass: the default locale is a deployment choice,
// and this pass is specifically about what an English session sees.
await i18n.setLocale('en', { notifyServer: false });
await settle();
await walk(PAGES, { tag: 'en', expectBangla: false });

await i18n.setLocale('bn', { notifyServer: false });
await settle();
await walk(PAGES, { tag: 'bn', expectBangla: true });

// Signed in: the account surface must have real content, and the admin area must
// stay shut to a player. The session cookie rides on the fetch wrapper above, and
// refreshSession() is what a real browser does on boot.
const email = `dom${Date.now().toString(36)}@example.test`;
const reg = await nodeFetch(`${app.base}/api/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, username: email.split('@')[0], password: 'TestUser!2026', confirmAge: true, acceptTerms: true }),
});
const regBody = await reg.json();
if (regBody?.ok !== true) { failed += 1; report.push(`FAIL auth register ${JSON.stringify(regBody?.error || regBody)}`); }
sessionCookie = (reg.headers.getSetCookie()[0] || '').split(';')[0];
await i18n.setLocale('en', { notifyServer: false });

// Sign in the way a visitor does: type into the form and submit it. That covers the
// form builder, the API client, CSRF and session hydration in one go — and if the
// button is inert, nothing below this point renders and the check says so.
await client.navigate('/login');
await settle();
const form = window.document.querySelector('#main form');
if (!form) {
  failed += 1;
  report.push('FAIL /login did not render a <form> — nothing to submit');
} else {
  const fill = (name, value) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (!el) return `no [name=${name}] field`;
    el.value = value;
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    return null;
  };
  const missing = [fill('identifier', email), fill('password', 'TestUser!2026')].filter(Boolean);
  if (missing.length) { failed += 1; report.push(`FAIL /login form ${missing.join(', ')}`); }
  else {
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(24);
    if (!window.App?.state?.user) {
      failed += 1;
      report.push('FAIL submitting the login form left the client signed out (no session, no balance)');
    }
  }
}
const stateMod2 = stateMod;
void stateMod2;
const authPages = [
  ['/account', 'account home'],
  ['/account/wallet', 'wallet'],
  ['/account/history', 'bet history'],
  ['/account/favorites', 'favourites'],
  ['/account/notifications', 'notifications'],
  ['/account/responsible', 'limits and self-exclusion'],
  ['/account/support', 'support tickets'],
  ['/account/settings', 'settings'],
  ['/admin', 'admin as a player'],
];
await walk(authPages, { tag: 'auth', expectBangla: false });

// One real bet, placed by clicking the button the way a player does: the client
// builds the payload, the server settles it, and the result has to reach both the
// wallet pill and the game's own readout.
await client.navigate('/game/lucky-dice');
await settle();
const before = app.db.pluck('select count(*) from bets');
const betBtn = window.document.querySelector('#main [data-role=place]');
if (!betBtn) {
  failed += 1;
  report.push('FAIL the dice panel rendered no [data-role=place] button — the game cannot be played');
} else {
  betBtn.click();
  await settle(30);
  const after = app.db.pluck('select count(*) from bets');
  const roll = window.document.querySelector('#main [data-role=roll]')?.textContent?.trim();
  const balance = window.document.querySelector('#main, #hdr-tools')?.textContent || '';
  const problems = [];
  if (after <= before) problems.push(`no bet reached the server (bets ${before} -> ${after})`);
  if (!roll || roll === '—') problems.push('the dice readout never updated');
  if (!/\u09f3|\d/.test(balance)) problems.push('the wallet area shows no balance');
  if (problems.length) { failed += 1; report.push(`FAIL placing a bet: ${problems.join(' | ')}`); }
  else report.push(`ok   bet placing a bet on /game/lucky-dice  bets ${before} -> ${after}, roll ${roll}`);
}

const failures = report.filter((line) => line.startsWith('FAIL'));
if (process.env.VERBOSE || !failures.length) console.log(report.join('\n'));
else {
  console.log(`${report.length} page renders, ${failures.length} of them wrong:\n`);
  console.log(failures.join('\n'));
}
if (errors.length) {
  console.log(`\n${errors.length} client error(s):`);
  for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
}
if (failed || errors.length) {
  console.log(`\n${failed} page problem(s), ${errors.length} client error(s).`);
  try { window.close(); } catch { /* already gone */ }
  await app.close();
  process.exit(1);
}
console.log(`\nOK — ${report.length} page renders (English, Bangla, signed in) with no client errors, no raw keys and no leaked values.`);
try { window.close(); } catch { /* already gone */ }
await app.close();
process.exit(0);

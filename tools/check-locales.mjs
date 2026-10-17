#!/usr/bin/env node
/**
 * Locale integrity check: `npm run check:locale`.
 *
 * The product promise is that the interface switches language completely — no
 * half-translated screen, no raw key printed where a word should be. That promise
 * is easy to break by accident: a key added to the English catalogue and not to
 * Bangla, a placeholder renamed in one file, a typo in a `t('…')` call.
 *
 * So this checks three things and fails on any of them:
 *   1. both catalogues have exactly the same flattened keys,
 *   2. `{placeholder}` sets match per key, and no value is empty,
 *   3. every `t('key')` / `data-i18n="key"` written in the client code exists.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOCALES = ['en', 'bn'];
const JS_DIR = path.join(ROOT, 'public', 'js');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
};

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = typeof v === 'string' ? v : String(v ?? '');
  }
  return out;
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const problems = [];
const catalogues = {};
for (const code of LOCALES) {
  const file = path.join(JS_DIR, 'locales', `${code}.js`);
  const mod = await import(pathToFileURL(file).href);
  catalogues[code] = flatten(mod.default || {});
  const keys = Object.keys(catalogues[code]);
  console.log(`${code}: ${keys.length} keys`);
}

// 1. same keys both ways
const [en, bn] = LOCALES.map((code) => catalogues[code]);
const missing = { en: [], bn: [] };
for (const code of LOCALES) {
  const own = catalogues[code];
  const other = catalogues[code === 'en' ? 'bn' : 'en'];
  for (const key of Object.keys(own)) if (!(key in other)) missing[code === 'en' ? 'bn' : 'en'].push(key);
}
if (missing.bn.length) problems.push(`keys in English with no Bangla entry (${missing.bn.length}): ${missing.bn.slice(0, 8).join(', ')}`);
if (missing.en.length) problems.push(`keys in Bangla with no English entry (${missing.en.length}): ${missing.en.slice(0, 8).join(', ')}`);

// 2. empty values and mismatched placeholders
for (const code of LOCALES) {
  for (const [key, value] of Object.entries(catalogues[code])) {
    if (!value.trim()) problems.push(`${code}: ${key} is empty`);
  }
}
for (const key of Object.keys(en)) {
  if (!(key in bn)) continue;
  const a = placeholders(en[key]);
  const b = placeholders(bn[key]);
  if (a !== b) problems.push(`placeholders differ for ${key}: en{${a}} bn{${b}}`);
}

// 3. references written in code resolve in both catalogues
const refs = new Map();
const files = walk(JS_DIR).filter((f) => !f.includes(`${path.sep}locales${path.sep}`));
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) add(file, m[1]);
  for (const m of src.matchAll(/data-i18n=\$\{['"]([^'"]+)['"]\}|data-i18n="([^"]+)"/g)) add(file, m[1] || m[2]);
}
function add(file, key) {
  if (!key || key.includes('${') || key.length < 3) return;
  if (!refs.has(key)) refs.set(key, []);
  refs.get(key).push(path.relative(ROOT, file));
}
const unresolved = [...refs.keys()].filter((key) => !(key in en) && !(key in bn));
for (const key of unresolved) problems.push(`code asks for a key that no catalogue defines: ${key} (${refs.get(key)[0]}${refs.get(key).length > 1 ? ` +${refs.get(key).length - 1} more` : ''})`);

// Keys only reachable at runtime (server codes, dynamic names) cannot be resolved
// statically, so they are reported for information, not as a failure.
const dynamic = new Set();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*`([^`]*)\$\{/g)) dynamic.add(m[1]);
}

const identical = Object.keys(en).filter((k) => k in bn && /^[A-Za-z .,'&/:()%#-]+$/.test(en[k]) && en[k] === bn[k]);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
  process.exit(1);
}
console.log(`\nOK — ${Object.keys(en).length} keys per locale, ${refs.size} referenced keys resolve, ${dynamic.size} dynamic key prefixes, ${identical.length} shared literals (brand or technical terms kept as-is).`);

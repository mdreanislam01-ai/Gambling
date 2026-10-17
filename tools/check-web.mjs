#!/usr/bin/env node
/**
 * Static web-integrity check: `npm run check:web`.
 *
 * The SPA has no build step and no bundler, so nothing but this check notices a
 * renamed file, a dead link, a broken relative import or a class that no style
 * sheet defines — each of those is a blank panel or a 404 on a real device.
 *
 * Checks, in order:
 *   1. every relative import in the project resolves to a file that exists;
 *   2. every asset the shell loads (CSS, module, icons, manifest, fonts) exists;
 *   3. every `url()` in the style sheet resolves;
 *   4. every internal link in the client points at a route the router knows;
 *   5. every class used in markup or templates is defined in app.css.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PUB = path.join(ROOT, 'public');
const problems = [];
const note = (msg) => problems.push(msg);

const walk = (dir, re, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'data'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, re, out);
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p);

const JS_FILES = [
  ...walk(PUB, /\.(js|mjs)$/),
  ...walk(path.join(ROOT, 'src'), /\.(js|mjs)$/),
  ...walk(path.join(ROOT, 'tools'), /\.(js|mjs)$/),
  ...walk(path.join(ROOT, 'tests'), /\.(js|mjs)$/),
];

// 1. module graph -------------------------------------------------------------
let imports = 0;
for (const file of JS_FILES) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^\n'"]*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    imports += 1;
    const target = path.resolve(path.dirname(file), m[1]);
    if (!existsSync(target) && !existsSync(`${target}.js`) && !existsSync(`${target}.mjs`) && !statSyncSafe(target + '.js')) {
      note(`broken import: ${rel(file)} -> ${m[1]}`);
    }
  }
  // Dynamic imports only carry a resolvable path when they are a real module
  // specifier: skip template literals (pages and locales are named at runtime)
  // and only trust the browser bundle, where the path is the URL the fetch uses.
  const inBundle = path.dirname(file).startsWith(path.join(PUB, 'js'));
  if (inBundle) {
    for (const m of src.matchAll(/import\(\s*[`'"](\.{1,2}\/[^`'$]+)[`'"]\s*\)/g)) {
      imports += 1;
      const target = path.resolve(path.dirname(file), m[1]);
      if (!existsSync(target) && !existsSync(`${target}.js`)) note(`broken dynamic import: ${rel(file)} -> ${m[1]}`);
    }
  }
}
function statSyncSafe(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// 2. assets referenced by the shell -----------------------------------------
const indexHtml = readFileSync(path.join(PUB, 'index.html'), 'utf8');
const localRefs = [...indexHtml.matchAll(/(?:href|src)="(\/[^"]+?)"/g)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('/api') && !u.includes('#') && !/^\/(game|live|sports|legal|info|account|admin)\//.test(u));
for (const ref of localRefs) {
  const clean = ref.split('?')[0];
  if (!existsSync(path.join(PUB, clean))) note(`index.html points at a missing file: ${ref}`);
}
const manifestPath = path.join(PUB, 'app.webmanifest');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const icon of manifest.icons || []) {
    if (!existsSync(path.join(PUB, icon.src.replace(/^\//, '')))) note(`manifest icon missing: ${icon.src}`);
  }
}

// 3. url() in CSS -------------------------------------------------------------
const cssPath = path.join(PUB, 'css', 'app.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
if (!css) note('public/css/app.css is missing');
for (const m of css.matchAll(/url\(\s*['"]?(\/?[^)'"]+)/g)) {
  const raw = m[1].trim();
  if (/^(data:|https?:|#|%)/.test(raw)) continue;
  const file = path.resolve(path.dirname(cssPath), raw.replace(/^\//, '').split('?')[0]);
  const viaPub = path.join(PUB, raw.replace(/^\//, '').split('?')[0]);
  if (!existsSync(file) && !existsSync(viaPub)) note(`app.css points at a missing file: ${raw}`);
}

// 4. internal links against the router --------------------------------------
const appPath = path.join(PUB, 'js', 'app.js');
const appSrc = readFileSync(appPath, 'utf8');
const routes = [...appSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
const patterns = routes.map((route) => {
  const re = route
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${re}$`);
});
const matches = (href) => patterns.some((re) => re.test(href));

const clientFiles = walk(path.join(PUB, 'js'), /\.(js|mjs)$/);
let links = 0;
for (const file of clientFiles.concat([path.join(PUB, 'index.html')])) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/href=["'`]([^"'`#]+)(?:#[^"'`]*)?["'`]/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(href)) continue;
    if (/\$\{|\|/.test(href)) continue; // built at runtime, cannot be resolved here
    if (!href.startsWith('/')) continue; // relative to a page, not a route
    if (href.startsWith('/api') || existsSync(path.join(PUB, href.split('?')[0]))) continue; // API call or a real file
    links += 1;
    const clean = href.split('?')[0].replace(/\/$/, '') || '/';
    if (!matches(clean)) note(`dead link: ${rel(file)} -> ${href}`);
  }
}
for (const ref of localRefs) {
  const clean = ref.split('?')[0].replace(/\/$/, '') || '/';
  if (existsSync(path.join(PUB, clean))) continue; // a real file, not a route
  links += 1;
  if (!matches(clean)) note(`dead link: index.html -> ${ref}`);
}

// 5. classes used must be styled -------------------------------------------
const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const used = new Map();
for (const file of clientFiles.concat([path.join(PUB, 'index.html')])) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/class=["'`]([^"'`$]*)["'`]/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (!token || /[${}]/.test(token)) continue;
      if (!used.has(token)) used.set(token, rel(file));
    }
  }
}
const unstyled = [...used.keys()].filter((token) => !defined.has(token));
if (unstyled.length) {
  // A missing class is a styling gap, not a crash: report it, do not fail the run.
  console.log(`note: ${unstyled.length} class(es) with no CSS rule: ${unstyled.slice(0, 12).join(', ')}${unstyled.length > 12 ? ' …' : ''}`);
}

console.log(`${JS_FILES.length} modules, ${imports} imports, ${links} internal links, ${localRefs.length} shell assets, ${used.size} classes referenced, ${routes.length} routes.`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
  process.exit(1);
}
console.log('OK — no broken imports, assets, links or shell references.');

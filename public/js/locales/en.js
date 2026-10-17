/**
 * English catalogue entry point. Groups live in ./en/*.js so each file stays
 * reviewable; they are deep-merged leaf by leaf, so a later part may extend or
 * override a namespace without redefining it.
 */
import ui from './en/ui.js';
import pages from './en/pages.js';
import account from './en/account.js';
import games from './en/games.js';
import sports from './en/sports.js';
import admin from './en/admin.js';
import misc from './en/misc.js';

const isLeaf = (v) => typeof v === 'string' || typeof v === 'number';
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (isLeaf(v) || !out[k] || isLeaf(out[k])) out[k] = v;
    else out[k] = merge(out[k], v);
  }
  return out;
}

export default [ui, pages, account, games, sports, admin, misc].reduce(merge, {});

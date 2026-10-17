/**
 * Bangla catalogue — mirrors en.js key for key entry point. Groups live in ./bn/*.js so each file stays
 * reviewable; they are deep-merged leaf by leaf, so a later part may extend or
 * override a namespace without redefining it.
 */
import ui from './bn/ui.js';
import pages from './bn/pages.js';
import account from './bn/account.js';
import games from './bn/games.js';
import sports from './bn/sports.js';
import admin from './bn/admin.js';
import misc from './bn/misc.js';

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

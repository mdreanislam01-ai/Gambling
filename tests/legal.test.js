/**
 * The policy pages are product surface, not decoration: a missing paragraph, an
 * English clause inside a Bangla document, or a rule the game does not implement
 * are all bugs. This file is also the guard that the legal module is imported by
 * the server and cannot silently disappear.
 */
import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { LEGAL_DOCS, legalDoc, legalIndex, legalParity } from '../src/data/legal.js';
import { bootTestApp } from './helpers/app.js';

let app;
before(async () => { app = await bootTestApp(); });
after(async () => { await app.close(); });

describe('legal documents', () => {
  it('cover the promises the product makes', () => {
    assert.deepEqual(LEGAL_DOCS, ['terms', 'privacy', 'responsible', 'fairness', 'rules', 'security', 'help']);
    for (const key of LEGAL_DOCS) {
      const doc = legalDoc(key, 'en');
      assert.ok(doc, `${key} exists in English`);
      assert.ok(doc.sections.length >= 3, `${key} has ${doc.sections.length} sections`);
      for (const section of doc.sections) {
        assert.ok(section.heading, `${key}: every section has a heading`);
        assert.ok(section.paragraphs.length >= 2, `${key} / ${section.heading}: at least two paragraphs`);
        assert.ok(section.paragraphs.every((p) => p.length > 60), `${key} / ${section.heading}: paragraph looks truncated`);
      }
    }
  });

  it('are fully translated, with no clause dropped from the Bangla text', () => {
    assert.deepEqual(legalParity(), [], 'English and Bangla must carry the same sections and paragraph counts');
    for (const key of LEGAL_DOCS) {
      const bn = legalDoc(key, 'bn');
      assert.equal(bn.locale, 'bn');
      assert.match(bn.title, /[\u0980-\u09FF]/, `${key}: Bangla title`);
      for (const section of bn.sections) {
        assert.match(section.heading, /[\u0980-\u09FF]/, `${key} / ${section.heading}: Bangla heading`);
        for (const paragraph of section.paragraphs) {
          const letters = paragraph.replace(/[^\u0980-\u09FF]/g, '').length;
        assert.ok(letters >= 20, `${key}: paragraph has no Bangla sentence in it (${letters} letters)`);
        }
      }
    }
    // An unknown language falls back to English rather than half-translating.
    assert.equal(legalDoc('terms', 'fr').locale, 'en');
    assert.equal(legalDoc('nope', 'en'), null);
  });

  it('say that credits have no monetary value and refuse to describe payouts', () => {
    const terms = legalDoc('terms', 'en').sections.flatMap((s) => [s.heading, ...s.paragraphs]).join(' ');
    assert.match(terms, /no deposit, no withdrawal/i);
    assert.match(terms, /no resale value/i);
    // Nothing in the policy may promise money in or out.
    for (const key of LEGAL_DOCS) {
      for (const lang of ['en', 'bn']) {
        const text = JSON.stringify(legalDoc(key, lang));
        assert.doesNotMatch(text, /withdraw(al)? (method|options|page)/i, `${key}: describes withdrawals`);
        assert.doesNotMatch(text, /deposit (method|gateway)/i, `${key}: describes deposits`);
        assert.doesNotMatch(text, /(visa|mastercard|paypal|bitcoin|bKash|nagad)/i, `${key}: names a payment provider`);
      }
    }
  });

  it('describe the table rules the engines actually implement', () => {
    const rules = legalDoc('rules', 'en');
    const text = rules.sections.flatMap((s) => [s.heading, ...s.paragraphs]).join(' ');
    // Blackjack: the shipped ruleset, so a player is not promised options that
    // do not exist. `cards.js` implements stands-on-17, 3:2, one split, no insurance.
    assert.match(text, /dealer stands on all 17s/i);
    assert.match(text, /blackjack pays 3:2/i);
    assert.match(text, /no surrender/i);
    assert.match(text, /Insurance is not offered/i);
    assert.doesNotMatch(text, /insurance pays 2:1/i, 'the policy must not advertise a side bet the game removed');
    // Roulette paytable as implemented in src/games/table.js (total returns).
    assert.match(text, /Straight pays 35:1, split 11:1, street 11:1, corner 8:1, line 5:1/);
    // Baccarat commission and tie push, 3-patti Pair Plus tiers and no tie bet.
    assert.match(text, /Banker pays 0\.95:1 after the 5% commission/i);
    assert.match(text, /There is no Tie side bet/i);
    const bangla = legalDoc('rules', 'bn').sections.flatMap((s) => s.paragraphs).join(' ');
    assert.match(bangla, /insurance নেই/);
    assert.match(bangla, /Tie সাইড বাজি নেই/);
  });

  it('are served already localised, so the client never re-picks a language', async () => {
    const client = app.client();
    const list = await client.get('/api/legal');
    assert.equal(list.status, 200);
    assert.equal(list.body.ok, true);
    assert.deepEqual(list.body.data.docs.map((d) => d.key), LEGAL_DOCS);
    assert.ok(list.body.data.docs.every((d) => d.sections > 0));
    assert.ok(typeof list.body.data.termsVersion === 'string' && list.body.data.termsVersion.length > 0);

    const en = await client.get('/api/legal/terms');
    assert.equal(en.status, 200);
    assert.equal(en.body.data.locale, 'en');
    assert.match(en.body.data.title, /Terms of use/);

    const bn = await client.get('/api/legal/terms?locale=bn');
    assert.equal(bn.status, 200);
    assert.equal(bn.body.data.locale, 'bn');
    assert.match(bn.body.data.title, /ব্যবহারের শর্ত/);

    // The footer and account page link these aliases, so they must resolve.
    for (const alias of ['gambling-help', 'how-to-play', 'provably-fair', 'fair']) {
      const res = await client.get(`/api/legal/${alias}`);
      assert.equal(res.status, 200, `${alias} should resolve`);
      assert.ok(res.body.data.sections.length >= 3, `${alias} returned a short document`);
    }

    const missing = await client.get('/api/legal/nonexistent');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'err.doc_missing');
    assert.equal(missing.body.error.params.doc, 'nonexistent');

    const index = legalIndex('bn');
    assert.equal(index.length, LEGAL_DOCS.length);
    assert.ok(index.every((d) => /[\u0980-\u09FF]/.test(d.title)));
  });
});

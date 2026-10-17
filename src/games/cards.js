import { Rng, buildDeck, rankOf, suitOf, rankIdx } from './rng.js';

// ---------------------------------------------------------------------------
// BLACKJACK — 6 decks, dealer stands on soft 17, blackjack pays 3:2, double on
// any first two cards, one split allowed. Hand state is durable: it is stored
// on the bet row, so a page refresh or server restart never loses a hand.
// ---------------------------------------------------------------------------
export function cardTotal(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === 'A') { aces += 1; t += 11; }
    else if (r === 'K' || r === 'Q' || r === 'J' || r === '10') t += 10;
    else t += Number(r) || 0;
  }
  while (t > 21 && aces > 0) { t -= 10; aces -= 1; }
  return { total: t, soft: aces > 0 };
}

function bjView(s, reveal = false) {
  const open = reveal || s.phase !== 'player';
  return {
    hands: s.hands.map((h, i) => {
      const t = cardTotal(h.cards);
      return { cards: h.cards, total: t.total, soft: t.soft, done: !!h.done, bust: !!h.bust, active: (s.active ?? 0) === i && s.phase === 'player', bet: h.bet, doubled: !!h.doubled };
    }),
    dealer: open ? s.dealer.map((c) => ({ code: c, hidden: false })) : [{ code: s.dealer[0], hidden: false }, { code: '?', hidden: true }],
    dealerTotal: cardTotal(open ? s.dealer : [s.dealer[0]]).total,
    phase: s.phase,
    insuranceOffer: !!s.insuranceOffer && s.phase === 'player',
    wagered: s.wagered,
    payouts: s.payouts,
  };
}

function bjActions(s) {
  const h = s.hands[s.active];
  if (!h || h.done || s.phase !== 'player') return [];
  const a = ['hit', 'stand'];
  if (h.cards.length === 2) a.push('double');
  if (h.cards.length === 2 && rankOf(h.cards[0]) === rankOf(h.cards[1]) && s.splits < 1) a.push('split');
  return a;
}

function bjResult(s, wagered, payout, status, results) {
  s.phase = 'payout';
  return {
    status,
    payout,
    multiplier: wagered ? payout / wagered : 0,
    state: s,
    view: { ...bjView(s, true), results: results || [] },
    outcome: { dealer: s.dealer, dealerTotal: cardTotal(s.dealer).total, hands: s.hands.map((h) => ({ cards: h.cards, total: cardTotal(h.cards).total, bet: h.bet, bust: !!h.bust })), results: results || [] },
  };
}

function bjPlayOut(s) {
  while (cardTotal(s.dealer).total < 17) s.dealer.push(s.deck[s.cursor++]);
  const dt = cardTotal(s.dealer).total;
  let payout = 0;
  const results = [];
  for (const h of s.hands) {
    const pt = cardTotal(h.cards);
    if (h.bust || pt.total > 21) { results.push({ status: 'lost', payout: 0, cards: h.cards, total: pt.total }); continue; }
    if (pt.total === dt) { payout += h.bet; results.push({ status: 'void', payout: h.bet, cards: h.cards, total: pt.total }); continue; }
    if (dt > 21 || pt.total > dt) { payout += h.bet * 2; results.push({ status: 'won', payout: h.bet * 2, cards: h.cards, total: pt.total }); continue; }
    results.push({ status: 'lost', payout: 0, cards: h.cards, total: pt.total });
  }
  const st = payout === 0 ? 'lost' : payout <= s.wagered ? 'void' : 'won';
  return bjResult(s, s.wagered, payout, st, results);
}

export const blackjack = {
  key: 'blackjack',
  multiStep: true,
  init({ stake, rng }) {
    const deck = buildDeck(new Rng(`${rng.seedKey}|bj`), 6);
    const s = { deck, cursor: 0, hands: [], dealer: [], phase: 'player', active: 0, splits: 0, wagered: stake, maxWager: stake * 2 };
    const draw = () => s.deck[s.cursor++];
    s.hands = [{ cards: [draw(), draw()], bet: stake, done: false }];
    s.dealer = [draw(), draw()];
    if (rankOf(s.dealer[0]) === 'A') s.insuranceOffer = true;
    const playerBJ = cardTotal(s.hands[0].cards).total === 21;
    const dealerBJ = cardTotal(s.dealer).total === 21;
    if (playerBJ || dealerBJ) {
      if (playerBJ && dealerBJ) return bjResult(s, stake, stake, 'void', [{ status: 'void', payout: stake, cards: s.hands[0].cards, total: 21 }]);
      if (playerBJ) {
        const payout = stake + Math.floor(stake * 1.5);
        return bjResult(s, stake, payout, 'won', [{ status: 'won', payout, cards: s.hands[0].cards, total: 21, natural: true }]);
      }
      return bjResult(s, stake, 0, 'lost', [{ status: 'lost', payout: 0, cards: s.hands[0].cards, total: cardTotal(s.hands[0].cards).total }]);
    }
    return { status: 'pending', state: s, view: bjView(s), actions: bjActions(s) };
  },
  act({ state, action, stake, selection }) {
    const s = state;
    if (s.phase !== 'player') return { error: 'err.hand_closed' };
    const hand = s.hands[s.active];
    const draw = () => s.deck[s.cursor++];
    if (action === 'hit') {
      hand.cards.push(draw());
      if (cardTotal(hand.cards).total > 21) { hand.done = true; hand.bust = true; }
    } else if (action === 'stand') {
      hand.done = true;
    } else if (action === 'double') {
      if (hand.cards.length !== 2 || s.wagered + stake > s.maxWager) return { error: 'err.action_not_allowed' };
      hand.cards.push(draw());
      hand.bet = stake * 2;
      hand.doubled = true;
      s.wagered += stake;
      if (cardTotal(hand.cards).total > 21) hand.bust = true;
      hand.done = true;
    } else if (action === 'split') {
      if (hand.cards.length !== 2 || rankOf(hand.cards[0]) !== rankOf(hand.cards[1]) || s.splits >= 1) return { error: 'err.action_not_allowed' };
      if (s.wagered + stake > s.maxWager) return { error: 'err.bet_exceeds_balance' };
      const [a, b] = hand.cards;
      s.splits += 1;
      s.maxWager = stake * 3;
      s.hands = [
        { cards: [a, draw()], bet: stake, done: false },
        { cards: [b, draw()], bet: stake, done: false },
      ];
      if (rankOf(a) === 'A') s.hands.forEach((h) => { if (cardTotal(h.cards).total === 21) h.done = true; });
      s.active = s.hands.findIndex((h) => !h.done);
      if (s.active === -1) return bjPlayOut(s);
      return { status: 'pending', state: s, view: bjView(s), actions: bjActions(s) };
    } else {
      return { error: 'err.action_unknown' };
    }
    const next = s.hands.findIndex((h) => !h.done);
    if (next === -1) return bjPlayOut(s);
    s.active = next;
    return { status: 'pending', state: s, view: bjView(s), actions: bjActions(s) };
  },
  /** Called when an unfinished hand is abandoned (round timeout / restart). */
  timeout: (s) => bjPlayOut(s),
};

// ---------------------------------------------------------------------------
// BACCARAT — Punto Banco third-card rules, 5 % commission on Banker, tie push.
//
// These maps are the whole truth about what a side pays: the client renders its
// chips from them (see engineDisplayConfig in src/api/game.js) instead of
// keeping its own copy, because a displayed "12:1" over a paid "11:1" is a
// promise the game does not keep.
// ---------------------------------------------------------------------------
export const BACC_SIDES = ['player', 'banker', 'tie', 'pair_player', 'pair_banker'];
export const BACCARAT_PAYS = { player: 2, banker: 1.95, tie: 9, pair_player: 11, pair_banker: 11 };

export const PATTI_SIDES = ['player', 'pair_plus'];
/**
 * Total-return multipliers. `tie` used to be a selectable side at 8:1 while an
 * exact tie between two 3-card hands happens about once in 1600 rounds — a 0.5%
 * return bet, i.e. a trap wearing an odds label. The dealer still wins ties
 * (that is where the player bet's edge comes from); the side bet is gone.
 */
export const PATTI_PAYS = { player: 2, pair_plus: { trail: 28, pure_seq: 18, seq: 8, color: 4, pair: 2 } };

const pTotal = (cards) => cards.reduce((a, c) => {
  const r = rankOf(c);
  return a + (r === 'A' ? 1 : r === '10' || r === 'J' || r === 'Q' || r === 'K' ? 0 : Number(r) || 0);
}, 0) % 10;

export const baccarat = {
  key: 'baccarat',
  init({ rng, selection }) {
    const bets = (Array.isArray(selection?.bets) ? selection.bets : []).filter((b) => b && BACC_SIDES.includes(b.side));
    const deck = buildDeck(new Rng(`${rng.seedKey}|bac`), 8);
    let c = 0;
    const next = () => deck[c++];
    const player = [next(), next()];
    const banker = [next(), next()];
    const pt = pTotal(player);
    const bt = pTotal(banker);
    let natural = pt >= 8 || bt >= 8;
    if (!natural) {
      if (pt <= 5) {
        player.push(next());
        const p3 = rankOf(player[2]) === 'A' ? 1 : ['10','J','Q','K'].includes(rankOf(player[2])) ? 0 : Number(rankOf(player[2]));
        if (!((pt >= 7) || (bt >= 7))) {
          const rule = {
            0: true, 1: true, 2: true,
            3: p3 !== 8, 4: p3 >= 2 && p3 <= 7, 5: p3 >= 4 && p3 <= 7, 6: p3 >= 6 && p3 <= 7, 7: false,
          };
          if (rule[bt]) banker.push(next());
        }
      } else if (bt <= 5) banker.push(next());
    }
    const fp = pTotal(player);
    const fb = pTotal(banker);
    const winner = fp > fb ? 'player' : fb > fp ? 'banker' : 'tie';
    const pp = player[0][0] === player[1][0];
    const bp = banker[0][0] === banker[1][0];
    const pays = BACCARAT_PAYS;
    let payout = 0;
    let staked = 0;
    const legs = bets.map((b) => {
      const amount = Math.max(0, Math.round(Number(b.amount) || 0));
      staked += amount;
      let won = false;
      if (b.side === winner) won = true;
      if (b.side === 'pair_player' && pp) won = true;
      if (b.side === 'pair_banker' && bp) won = true;
      // Punto Banco: a tie pushes Player and Banker. Treating it as a loss took
      // ~9.5% of every stake and put the game at 90% against a 98.9% label.
      const push = winner === 'tie' && (b.side === 'player' || b.side === 'banker');
      const pay = won ? Math.floor(amount * pays[b.side]) : push ? amount : 0;
      payout += pay;
      return { side: b.side, amount, won, push, payout: pay };
    });
    return {
      status: payout === 0 ? 'lost' : payout === staked ? 'void' : 'won',
      payout,
      multiplier: staked ? payout / staked : 0,
      outcome: { player, banker, playerTotal: fp, bankerTotal: fb, winner, natural, playerPair: pp, bankerPair: bp, legs },
    };
  },
};

// ---------------------------------------------------------------------------
// VIDEO POKER — Jacks or Better, 9/6 paytable.
// ---------------------------------------------------------------------------
export const VP_PAYTABLE = {
  royal_flush: 250, straight_flush: 50, four: 25, full_house: 9, flush: 6,
  straight: 4, three: 3, two_pair: 2, jacks: 1, none: 0,
};
export const VP_HAND_KEYS = {
  royal_flush: 'game.vp.royal', straight_flush: 'game.vp.straightFlush', four: 'game.vp.four',
  full_house: 'game.vp.fullHouse', flush: 'game.vp.flush', straight: 'game.vp.straight',
  three: 'game.vp.three', two_pair: 'game.vp.twoPair', jacks: 'game.vp.jacks', none: 'game.vp.none',
};

export function evaluatePoker(cards) {
  const vals = cards.map(rankIdx).sort((a, b) => a - b);
  const suits = cards.map(suitOf);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);
  const flush = suits.every((s) => s === suits[0]);
  const wheel = vals.join(',') === '0,1,2,3,12';
  const straight = (vals.length === 5 && vals.every((v, i) => (i === 0 ? true : v === vals[i - 1] + 1))) || wheel;
  const high = vals.at(-1);
  if (flush && straight && high === 12 && vals[0] === 8) return 'royal_flush';
  if (flush && straight) return 'straight_flush';
  if (groups[0] === 4) return 'four';
  if (groups[0] === 3 && groups[1] === 2) return 'full_house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (groups[0] === 3) return 'three';
  if (groups[0] === 2 && groups[1] === 2) return 'two_pair';
  if (groups[0] === 2) {
    const [pairVal] = Object.entries(counts).filter(([, n]) => n === 2).map(([v]) => Number(v));
    // RANK_ORDER runs 2→0 … J→9, Q→10, K→11, A→12, so "jacks or better" is >= 9.
    // Reading this as >= 11 quietly dropped J and Q pairs — about 14 points of the
    // game's return, on a table named after them.
    return pairVal >= 9 ? 'jacks' : 'none';
  }
  return 'none';
}

export const videoPoker = {
  key: 'video_poker',
  multiStep: true,
  init({ rng, stake }) {
    const deck = buildDeck(new Rng(`${rng.seedKey}|vp`), 1);
    const s = { deck, cursor: 5, cards: deck.slice(0, 5), held: [], stake };
    return { status: 'pending', state: s, view: { cards: s.cards, held: [] }, actions: ['hold', 'draw'] };
  },
  act({ state, action, selection, stake }) {
    // Fall back to the state the previous action wrote: if the draw arrives
    // without `held` a second time, the player must still keep what they held.
    const source = Array.isArray(selection?.held) ? selection.held : (Array.isArray(state?.held) ? state.held : []);
    const held = [...new Set(source.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < 5))];
    const s = { ...state, held };
    if (action === 'hold') {
      // Holding all five is stand-pat: a made hand has to be able to keep it, so
      // this used to reject the only play a winning player wanted.
      return { status: 'pending', state: s, view: { cards: s.cards, held }, actions: ['draw'] };
    }
    if (action !== 'draw') return { error: 'err.action_unknown' };
    const cards = s.cards.slice();
    let cursor = s.cursor;
    for (let i = 0; i < 5; i += 1) if (!held.includes(i)) cards[i] = s.deck[cursor++];
    const hand = evaluatePoker(cards);
    const mult = VP_PAYTABLE[hand] ?? 0;
    const amount = stake || s.stake || 0;
    const payout = Math.floor(amount * mult);
    s.cards = cards;
    s.cursor = cursor;
    return {
      status: payout > amount ? 'won' : payout === amount && payout > 0 ? 'void' : 'lost',
      payout,
      multiplier: amount ? payout / amount : 0,
      state: s,
      view: { cards, held, hand, handKey: VP_HAND_KEYS[hand] },
      outcome: { cards, held, finalCards: cards, hand, handKey: VP_HAND_KEYS[hand], multiplier: mult },
    };
  },
  timeout: (s) => ({ status: 'lost', payout: 0, multiplier: 0, outcome: { abandoned: true, cards: s.cards } }),
};

// ---------------------------------------------------------------------------
// 3-PATTI — poker-style vs dealer, original ranking implementation.
// ---------------------------------------------------------------------------
function pattiRank(cards) {
  const vals = cards.map(rankIdx).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const counts = {};
  for (const v of vals) counts[v] = (counts[v] || 0) + 1;
  const g = Object.values(counts).sort((a, b) => b - a);
  const flush = suits.every((s) => s === suits[0]);
  const straight = vals[0] === vals[1] + 1 && vals[1] === vals[2] + 1;
  if (g[0] === 3) return { tier: 6, label: 'trail', tie: vals.join(',') };
  if (straight && flush) return { tier: 5, label: 'pure_seq', tie: vals.join(',') };
  if (straight) return { tier: 4, label: 'seq', tie: vals.join(',') };
  if (flush) return { tier: 3, label: 'color', tie: vals.join(',') };
  if (g[0] === 2) return { tier: 2, label: 'pair', tie: vals.join(',') };
  return { tier: 1, label: 'high', tie: vals.join(',') };
}

export const threePatti = {
  key: 'three_patti',
  init({ rng, selection }) {
    const bets = (Array.isArray(selection?.bets) ? selection.bets : []).filter((b) => PATTI_SIDES.includes(b.side));
    const deck = buildDeck(new Rng(`${rng.seedKey}|3p`), 2);
    const player = [deck[0], deck[2], deck[4]];
    const dealer = [deck[1], deck[3], deck[5]];
    const p = pattiRank(player);
    const d = pattiRank(dealer);
    const cmp = p.tier - d.tier || (p.tie > d.tie ? 1 : p.tie < d.tie ? -1 : 0);
    const pays = PATTI_PAYS;
    const pairPlusMult = pays.pair_plus;
    let payout = 0;
    let staked = 0;
    const legs = bets.map((b) => {
      const amount = Math.max(0, Math.round(Number(b.amount) || 0));
      staked += amount;
      let won = false;
      let mult = 0;
      if (b.side === 'player' && cmp > 0) { won = true; mult = pays.player; }
      if (b.side === 'pair_plus') {
        const m = pairPlusMult[p.label];
        if (m) { won = true; mult = m; }
      }
      const pay = won ? Math.floor(amount * mult) : 0;
      payout += pay;
      return { side: b.side, amount, won, payout: pay, mult };
    });
    return {
      status: payout === 0 ? 'lost' : 'won',
      payout,
      multiplier: staked ? payout / staked : 0,
      outcome: { player, dealer, playerRank: p.label, dealerRank: d.label, result: cmp > 0 ? 'player' : cmp < 0 ? 'dealer' : 'tie', legs },
    };
  },
};

export const cardGames = { blackjack, baccarat, videoPoker, threePatti };

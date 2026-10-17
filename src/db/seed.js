import { run, get, all, tx } from '../db/index.js';
import { Rng } from '../games/rng.js';
import { hashPassword } from '../lib/security.js';
import config from '../config.js';
import { migrate } from './migrate.js';
import { ensureWallet } from '../services/wallet.js';
import { buildMarketsFor } from '../services/sports.js';

const rng = new Rng('arenaplay-seed-v1');
const pick = (arr) => arr[rng.int(arr.length)];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/g, '-').replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// Casino catalogue
// ---------------------------------------------------------------------------
const slotConfig = (symbols, opts = {}) => ({
  reels: 3,
  rows: 3,
  lines: opts.lines ?? 5,
  symbols,
  freeSpins: opts.freeSpins ?? { scatterMin: 2, spins: 5, multiplier: 2 },
});

const GAMES = [
  {
    key: 'golden-voyage', name: 'Golden Voyage', nameKey: 'game.golden_voyage', category: 'slots', engine: 'slots',
    desc: 'game.desc.golden_voyage', min: 100, max: 500000, rtp: 9650, edge: 350, vol: 'medium', accent: 'gold',
    tags: ['jackpot', 'free-spins', 'classic'], new: 0, feat: 1, sort: 10, layout: 'wide',
    config: slotConfig([
      { key: 'ship', weight: 3, pays: { 3: 60 } }, { key: 'compass', weight: 6, pays: { 3: 20 } },
      { key: 'coin', weight: 12, pays: { 3: 6, 2: 1.2 } }, { key: 'anchor', weight: 12, pays: { 3: 5, 2: 1.1 } },
      { key: 'wild', weight: 5, pays: { 3: 90 }, wild: true }, { key: 'scatter', weight: 3, pays: {}, scatter: true },
    ]),
  },
  {
    key: 'pharaoh-gold', name: 'Pharaoh Gold', nameKey: 'game.pharaoh_gold', category: 'slots', engine: 'slots',
    desc: 'game.desc.pharaoh_gold', min: 100, max: 400000, rtp: 9600, edge: 400, vol: 'high', accent: 'amber',
    tags: ['egypt', 'multiplier'], new: 0, feat: 1, sort: 20,
    config: slotConfig([
      { key: 'scarab', weight: 4, pays: { 3: 55 } }, { key: 'mask', weight: 7, pays: { 3: 22 } },
      { key: 'eye', weight: 12, pays: { 3: 7, 2: 1.3 } }, { key: 'ankh', weight: 14, pays: { 3: 4 } },
      { key: 'wild', weight: 4, pays: { 3: 80 }, wild: true }, { key: 'scatter', weight: 4, pays: {}, scatter: true },
    ], { freeSpins: { scatterMin: 2, spins: 8, multiplier: 3 } }),
  },
  {
    key: 'lucky-fruit-3', name: 'Lucky Fruit 3', nameKey: 'game.lucky_fruit_3', category: 'slots', engine: 'slots',
    desc: 'game.desc.lucky_fruit_3', min: 50, max: 250000, rtp: 9700, edge: 300, vol: 'low', accent: 'emerald',
    tags: ['fruit', 'low-stake', 'classic'], new: 0, feat: 0, sort: 30,
    config: slotConfig([
      { key: 'melon', weight: 8, pays: { 3: 25, 2: 1.5 } }, { key: 'grape', weight: 12, pays: { 3: 10, 2: 1.2 } },
      { key: 'cherry', weight: 18, pays: { 3: 5, 2: 1 } }, { key: 'lemon', weight: 18, pays: { 3: 4, 2: 1 } },
      { key: 'seven', weight: 3, pays: { 3: 80 } }, { key: 'wild', weight: 5, pays: { 3: 40 }, wild: true },
    ], { freeSpins: null, lines: 3 }),
  },
  {
    key: 'dragon-fortune', name: 'Dragon Fortune', nameKey: 'game.dragon_fortune', category: 'slots', engine: 'slots',
    desc: 'game.desc.dragon_fortune', min: 200, max: 800000, rtp: 9550, edge: 450, vol: 'high', accent: 'crimson',
    tags: ['asia', 'megaways-style', 'jackpot'], new: 1, feat: 1, sort: 15, layout: 'hero',
    config: slotConfig([
      { key: 'dragon', weight: 3, pays: { 3: 120 } }, { key: 'lantern', weight: 7, pays: { 3: 25 } },
      { key: 'coin', weight: 14, pays: { 3: 8, 2: 1.4 } }, { key: 'fan', weight: 14, pays: { 3: 6 } },
      { key: 'wild', weight: 6, pays: { 3: 100 }, wild: true }, { key: 'scatter', weight: 4, pays: {}, scatter: true },
    ], { freeSpins: { scatterMin: 2, spins: 10, multiplier: 2 } }),
  },
  { key: 'european-roulette', name: 'European Roulette', nameKey: 'game.european_roulette', category: 'table', engine: 'roulette', desc: 'game.desc.european_roulette', min: 100, max: 1000000, rtp: 9730, edge: 270, vol: 'medium', accent: 'emerald', tags: ['roulette', 'inside-bets'], sort: 40, layout: 'wide' },
  { key: 'classic-blackjack', name: 'Classic Blackjack', nameKey: 'game.classic_blackjack', category: 'cards', engine: 'blackjack', desc: 'game.desc.classic_blackjack', min: 200, max: 600000, rtp: 9950, edge: 50, vol: 'low', accent: 'gold', tags: ['blackjack', 'strategy', 'split'], sort: 45, layout: 'wide' },
  { key: 'vip-blackjack', name: 'VIP Blackjack', nameKey: 'game.vip_blackjack', category: 'cards', engine: 'blackjack', desc: 'game.desc.vip_blackjack', min: 5000, max: 5000000, rtp: 9960, edge: 40, vol: 'low', accent: 'violet', tags: ['blackjack', 'high-roller'], visibility: 'logged_in', sort: 55, layout: 'wide' },
  { key: 'punto-banco', name: 'Baccarat Punto Banco', nameKey: 'game.punto_banco', category: 'table', engine: 'baccarat', desc: 'game.desc.punto_banco', min: 200, max: 1500000, rtp: 9894, edge: 106, vol: 'low', accent: 'crimson', tags: ['baccarat', 'commission'], sort: 50 },
  { key: 'jacks-or-better', name: 'Video Poker — Jacks or Better', nameKey: 'game.jacks_or_better', category: 'cards', engine: 'video_poker', desc: 'game.desc.jacks_or_better', min: 100, max: 400000, rtp: 9954, edge: 46, vol: 'medium', accent: 'cyan', tags: ['video-poker', 'skill'], sort: 60 },
  { key: 'three-patti-showdown', name: '3 Patti Showdown', nameKey: 'game.three_patti', category: 'cards', engine: 'three_patti', desc: 'game.desc.three_patti', min: 100, max: 500000, rtp: 9700, edge: 300, vol: 'high', accent: 'amber', tags: ['poker', 'south-asia', 'vs-dealer'], new: 1, sort: 58, layout: 'wide' },
  { key: 'lucky-dice', name: 'Lucky Dice', nameKey: 'game.lucky_dice', category: 'table', engine: 'dice', desc: 'game.desc.lucky_dice', min: 50, max: 500000, rtp: 9900, edge: 100, vol: 'medium', accent: 'emerald', tags: ['dice', 'fast'], sort: 65 },
  { key: 'bubble-mines', name: 'Bubble Mines', nameKey: 'game.bubble_mines', category: 'arcade', engine: 'mines', desc: 'game.desc.bubble_mines', min: 100, max: 300000, rtp: 9900, edge: 100, vol: 'high', accent: 'violet', tags: ['mines', 'arcade', 'skill'], sort: 70 },
  { key: 'money-drop-wheel', name: 'Money Drop Wheel', nameKey: 'game.money_drop_wheel', category: 'arcade', engine: 'wheel', desc: 'game.desc.money_drop_wheel', min: 100, max: 400000, rtp: 9600, edge: 400, vol: 'medium', accent: 'gold', tags: ['wheel', 'multiplier'], sort: 75 },
  { key: 'plinko-rush', name: 'Plinko Rush', nameKey: 'game.plinko_rush', category: 'arcade', engine: 'plinko', desc: 'game.desc.plinko_rush', min: 50, max: 250000, rtp: 9700, edge: 300, vol: 'high', accent: 'cyan', tags: ['plinko', 'arcade'], new: 1, sort: 80 },
  { key: 'lucky-ball-bingo', name: 'Lucky Ball Bingo', nameKey: 'game.lucky_ball_bingo', category: 'arcade', engine: 'bingo', desc: 'game.desc.lucky_ball_bingo', min: 100, max: 200000, rtp: 9500, edge: 500, vol: 'medium', accent: 'emerald', tags: ['bingo', 'pattern'], sort: 85 },
  { key: 'rocket-crash', name: 'Rocket Crash', nameKey: 'game.rocket_crash', category: 'crash', engine: 'crash', desc: 'game.desc.rocket_crash', min: 100, max: 600000, rtp: 9900, edge: 100, vol: 'high', accent: 'crimson', tags: ['crash', 'multiplayer', 'live'], feat: 1, sort: 5, layout: 'hero' },
  { key: 'live-roulette', name: 'Live Roulette — Studio A', nameKey: 'game.live_roulette', category: 'live', engine: 'roulette', desc: 'game.desc.live_roulette', min: 500, max: 1500000, rtp: 9730, edge: 270, vol: 'medium', accent: 'emerald', tags: ['live', 'roulette'], sort: 1, layout: 'live', visibility: 'logged_in' },
  { key: 'live-speed-roulette', name: 'Live Speed Roulette', nameKey: 'game.live_speed_roulette', category: 'live', engine: 'roulette', desc: 'game.desc.live_speed_roulette', min: 500, max: 1000000, rtp: 9730, edge: 270, vol: 'high', accent: 'gold', tags: ['live', 'fast'], sort: 2, layout: 'live', visibility: 'logged_in' },
  { key: 'live-baccarat', name: 'Live Baccarat — VIP Room', nameKey: 'game.live_baccarat', category: 'live', engine: 'baccarat', desc: 'game.desc.live_baccarat', min: 1000, max: 2500000, rtp: 9894, edge: 106, vol: 'low', accent: 'violet', tags: ['live', 'baccarat'], sort: 3, layout: 'live', visibility: 'logged_in' },
  { key: 'live-dream-wheel', name: 'Live Dream Wheel', nameKey: 'game.live_dream_wheel', category: 'live', engine: 'wheel', desc: 'game.desc.live_dream_wheel', min: 200, max: 800000, rtp: 9600, edge: 400, vol: 'medium', accent: 'amber', tags: ['live', 'wheel', 'host'], sort: 4, layout: 'live', visibility: 'logged_in' },
];

const LIVE_TABLES = [
  { key: 'lt-roulette-a', game: 'live-roulette', name: 'Roulette Studio A', nameKey: 'table.roulette_a', dealer: 'Nadia R.', studio: 'Dhaka Studio A', min: 500, max: 1500000, round: 22, seats: 12, accent: 'emerald' },
  { key: 'lt-roulette-speed', game: 'live-speed-roulette', name: 'Speed Roulette', nameKey: 'table.roulette_speed', dealer: 'Imran K.', studio: 'Dhaka Studio B', min: 500, max: 1000000, round: 12, seats: 15, accent: 'gold' },
  { key: 'lt-baccarat-vip', game: 'live-baccarat', name: 'VIP Baccarat Salon', nameKey: 'table.baccarat_vip', dealer: 'Sofia A.', studio: 'Premium Salon', min: 1000, max: 2500000, round: 26, seats: 7, accent: 'violet' },
  { key: 'lt-dream-wheel', game: 'live-dream-wheel', name: 'Dream Wheel Lounge', nameKey: 'table.dream_wheel', dealer: 'Rafi M.', studio: 'Lounge Set', min: 200, max: 800000, round: 18, seats: 20, accent: 'amber' },
];

// ---------------------------------------------------------------------------
// Sports
// ---------------------------------------------------------------------------
const LEAGUES = [
  { key: 'bpl', name: 'Bangladesh Premier League', nameKey: 'league.bpl', sport: 'cricket', country: 'Bangladesh', flag: 'BD', sort: 10 },
  { key: 'ipl', name: 'Indian Premier League', nameKey: 'league.ipl', sport: 'cricket', country: 'India', flag: 'IN', sort: 20 },
  { key: 'bpl-football', name: 'Bangladesh Premier League (football)', nameKey: 'league.bpl_fb', sport: 'football', country: 'Bangladesh', flag: 'BD', sort: 30 },
  { key: 'epl', name: 'English Premier League', nameKey: 'league.epl', sport: 'football', country: 'England', flag: 'EN', sort: 40 },
  { key: 'liga', name: 'La Liga', nameKey: 'league.liga', sport: 'football', country: 'Spain', flag: 'ES', sort: 50 },
  { key: 'ucl', name: 'Champions League', nameKey: 'league.ucl', sport: 'football', country: 'Europe', flag: 'EU', sort: 60 },
];

const TEAMS = {
  bpl: ['Comilla Victorians', 'Dhaka Capitals', 'Chattogram Challengers', 'Sylhet Strikers', 'Khulna Tigers', 'Rajshahi Royals'],
  ipl: ['Mumbai Strikers XI', 'Delhi Dynamos', 'Chennai Chargers', 'Kolkata Knights', 'Bengaluru Blaze'],
  'bpl-football': ['Bashundara Kings', 'Abahani Dhaka', 'Mohammedan SC', 'Sheikh Jamal', 'Rahmatganj MFS', 'Bashu Sansad'],
  epl: ['North London FC', 'Merseyside Blues', 'Manchester Reds', 'Chelsea Town', 'Spurs United', 'Newcastle Magpies'],
  liga: ['Madrid Blanco', 'Catalunya Blau', 'Atletico Rojo', 'Sevilla Nervion', 'Bilbao Athletic'],
  ucl: ['Madrid Blanco', 'Manchester Reds', 'Bayern Allianz', 'PSG Paris', 'Inter Milano', 'Porto Dragao'],
};

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export async function seed() {
  migrate();
  const summary = { games: 0, liveTables: 0, fixtures: 0, users: 0, bets: 0 };

  tx(() => {
    // ---- settings
    for (const [k, v] of Object.entries({
      site_name: 'ArenaPlay', maintenance_mode: '0', registration_open: '1', bets_enabled: '1',
      live_enabled: '1', sports_enabled: '1', default_locale: config.locale.default,
      demo_daily_bonus: config.demo.resetDailyBonus ? '1' : '0',
      crash_growth: '0.09', house_edge_bps: '100', support_email: 'support@arenaplay.local',
      terms_version: '1.0.0',
    })) {
      run(`INSERT INTO settings(key, value) VALUES(:k,:v) ON CONFLICT(key) DO NOTHING`, { k, v });
    }

    // ---- games
    for (const g of GAMES) {
      run(
        `INSERT INTO games(key, name, name_key, category, engine, description_key, min_bet, max_bet, rtp_bps, house_edge_bps,
                           volatility, layout, enabled, visibility, is_new, featured, popularity, plays, tags, accent, config, sort)
         VALUES(:key,:name,:nk,:cat,:engine,:dk,:min,:max,:rtp,:edge,:vol,:layout,1,:vis,:new,:feat,:pop,:plays,:tags,:accent,:cfg,:sort)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, engine = excluded.engine, category = excluded.category,
           min_bet = excluded.min_bet, max_bet = excluded.max_bet, rtp_bps = excluded.rtp_bps, house_edge_bps = excluded.house_edge_bps,
           volatility = excluded.volatility, layout = excluded.layout, tags = excluded.tags, accent = excluded.accent,
           config = excluded.config, sort = excluded.sort, description_key = excluded.description_key, name_key = excluded.name_key`,
        {
          key: g.key, name: g.name, nk: g.nameKey, cat: g.category, engine: g.engine, dk: g.desc,
          min: g.min, max: g.max, rtp: g.rtp, edge: g.edge, vol: g.vol, layout: g.layout ?? 'card',
          vis: g.visibility ?? 'public', new: g.new ?? 0, feat: g.feat ?? 0,
          pop: 20 + rng.int(400), plays: rng.int(40000),
          tags: JSON.stringify(g.tags ?? []), accent: g.accent ?? 'gold',
          cfg: JSON.stringify(g.config ?? {}), sort: g.sort ?? 100,
        }
      );
      summary.games += 1;
    }

    // ---- live tables
    for (const [i, t] of LIVE_TABLES.entries()) {
      run(
        `INSERT INTO live_tables(key, game_key, name, name_key, dealer_name, studio, status, min_bet, max_bet, seats, round_seconds, players, accent, enabled, sort)
         VALUES(:key,:g,:name,:nk,:dealer,:studio,'open',:min,:max,:seats,:round,:players,:accent,1,:sort)
         ON CONFLICT(key) DO UPDATE SET dealer_name = excluded.dealer_name, round_seconds = excluded.round_seconds,
           min_bet = excluded.min_bet, max_bet = excluded.max_bet, name = excluded.name, name_key = excluded.name_key`,
        { key: t.key, g: t.game, name: t.name, nk: t.nameKey, dealer: t.dealer, studio: t.studio, min: t.min, max: t.max, seats: t.seats, round: t.round, players: 4 + rng.int(25), accent: t.accent, sort: i + 1 }
      );
      summary.liveTables += 1;
    }

    // ---- leagues + teams
    const leagueIds = {};
    for (const l of LEAGUES) {
      run(`INSERT INTO sports_leagues(key, name, name_key, sport, country, flag, active, sort) VALUES(:k,:n,:nk,:s,:c,:f,1,:sort)
           ON CONFLICT(key) DO UPDATE SET name = excluded.name, name_key = excluded.name_key`,
        { k: l.key, n: l.name, nk: l.nameKey, s: l.sport, c: l.country, f: l.flag, sort: l.sort });
      leagueIds[l.key] = get(`SELECT id FROM sports_leagues WHERE key = :k`, { k: l.key }).id;
      for (const team of TEAMS[l.key]) {
        const short = team.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
        const found = get(`SELECT id FROM sports_teams WHERE name = :n AND sport = :s`, { n: team, s: l.sport });
        if (found) continue;
        run(`INSERT INTO sports_teams(league_id, name, short, sport, color) VALUES(:l,:n,:s,:sp,:c)`,
          { l: leagueIds[l.key], n: team, s: short, sp: l.sport, c: pick(['#e0b64d', '#2f6df6', '#e34b4b', '#2ecc71', '#8e44ad', '#16a085']) });
      }
    }

    // ---- fixtures: past results, one live window, upcoming slate
    const mkFixture = (leagueKey, sport, home, away, kickoffMs, opts = {}) => {
      const lid = leagueIds[leagueKey];
      const h = get(`SELECT id FROM sports_teams WHERE name = :n AND sport = :s`, { n: home, s: sport });
      const a = get(`SELECT id FROM sports_teams WHERE name = :n AND sport = :s`, { n: away, s: sport });
      if (!h || !a) return null;
      const r = run(
        `INSERT INTO sports_fixtures(league_id, sport, season, round, venue, home_team_id, away_team_id, kickoff, status,
                                      live_sim, source, created_at)
         VALUES(:l,:sp,:se,:ro,:v,:h,:a,:k,'scheduled',:sim,'demo',datetime('now'))`,
        {
          l: lid, sp: sport, se: '2026', ro: opts.round || pick(['Matchday 12', 'League stage', 'Qualifier 3', 'Group A']),
          v: opts.venue || pick(['Sher-e-Bangla Stadium', 'Bangabandhu Stadium', 'Sohrawardy Stadium', 'Sylhet International']),
          h: h.id, a: a.id, k: iso(kickoffMs), sim: opts.liveSim === false ? 0 : 1,
        }
      );
      summary.fixtures += 1;
      return Number(r.lastInsertRowid);
    };

    const H = 3600_000;
    const createdFixtures = [];
    // finished (results page)
    for (let i = 1; i <= 6; i += 1) {
      const leagueKey = pick(['epl', 'liga', 'bpl', 'bpl-football']);
      const sport = ['epl', 'liga', 'bpl-football'].includes(leagueKey) ? 'football' : 'cricket';
      const pool = TEAMS[leagueKey];
      const home = pick(pool);
      const away = pick(pool.filter((t) => t !== home));
      const f = mkFixture(leagueKey, sport, home, away, now - i * 26 * H, { liveSim: false });
      if (f) createdFixtures.push(f);
    }
    // live window (kicked off 20-55 minutes ago → the simulator marks them live)
    const liveSpecs = [
      ['bpl', 'cricket', 'Khulna Tigers', 'Dhaka Capitals', 38 * 60_000],
      ['epl', 'football', 'Merseyside Blues', 'Manchester Reds', 27 * 60_000],
      ['liga', 'football', 'Atletico Rojo', 'Sevilla Nervion', 63 * 60_000],
    ];
    for (const [league, sport, home, away, ago] of liveSpecs) {
      const f = mkFixture(league, sport, home, away, now - ago, { venue: 'Simulated Arena (demo)' });
      if (f) createdFixtures.push(f);
    }
    // upcoming
    const upcoming = [
      ['bpl', 'cricket', 'Comilla Victorians', 'Chattogram Challengers', 2.5 * H],
      ['bpl', 'cricket', 'Sylhet Strikers', 'Rajshahi Royals', 26 * H],
      ['ipl', 'cricket', 'Mumbai Strikers XI', 'Chennai Chargers', 50 * H],
      ['epl', 'football', 'North London FC', 'Spurs United', 5 * H],
      ['epl', 'football', 'Chelsea Town', 'Newcastle Magpies', 30 * H],
      ['epl', 'football', 'Manchester Reds', 'Merseyside Blues', 54 * H],
      ['liga', 'football', 'Madrid Blanco', 'Catalunya Blau', 8 * H],
      ['liga', 'football', 'Bilbao Athletic', 'Atletico Rojo', 32 * H],
      ['ucl', 'football', 'Bayern Allianz', 'PSG Paris', 76 * H],
      ['ucl', 'football', 'Inter Milano', 'Madrid Blanco', 100 * H],
      ['bpl-football', 'football', 'Abahani Dhaka', 'Mohammedan SC', 20 * H],
      ['bpl-football', 'football', 'Bashundara Kings', 'Sheikh Jamal', 46 * H],
    ];
    for (const [league, sport, home, away, inMs] of upcoming) {
      const f = mkFixture(league, sport, home, away, now + inMs);
      if (f) createdFixtures.push(f);
    }

    for (const id of createdFixtures) {
      const f = get(`SELECT * FROM sports_fixtures WHERE id = :id`, { id });
      if (f) buildMarketsFor(f);
    }

    // ---- banners + announcements (bilingual)
    const banners = [
      {
        titleEn: 'Play responsibly — 100% demo credits', subtitleEn: 'No real money, no deposits, no withdrawals. Every result is a simulation you can verify.',
        titleBn: 'দায়িত্বশীলভাবে খেলুন — ১০০% ডেমো ক্রেডিট', subtitleBn: 'কোনো আসল টাকা, ডিপোজিট বা উত্তোলন নেই। প্রতিটি ফলাফল যাচাইযোগ্য সিমুলেশন।',
        ctaEn: 'How it works', ctaBn: 'কীভাবে কাজ করে', badgeEn: 'DEMO', target: '/fairness', accent: 'gold', sort: 10,
      },
      {
        titleEn: 'Rocket Crash — new season of rounds', subtitleEn: 'Round starts every few seconds. Set an auto cash-out and watch the SSE ticker.',
        titleBn: 'রকেট ক্র্যাশ — নতুন রাউন্ড সেশন', subtitleBn: 'কয়েক সেকেন্ড পরপর রাউন্ড শুরু। অটো ক্যাশ-আউট সেট করে লাইভ টিকার দেখুন।',
        ctaEn: 'Open game', ctaBn: 'গেম খুলুন', badgeEn: 'HOT', target: '/game/rocket-crash', accent: 'crimson', sort: 20,
      },
      {
        titleEn: 'Live studio tables with simulated dealers', subtitleEn: 'Roulette, baccarat and the dream wheel — hosted on a scripted studio round clock.',
        titleBn: 'সিমুলেটেড ডিলারসহ লাইভ স্টুডিও টেবিল', subtitleBn: 'রুলেট, ব্যাকারেট ও ড্রিম হুইল — স্ক্রিপ্টেড স্টুডিও রাউন্ড ঘড়িতে পরিচালিত।',
        ctaEn: 'Browse live', ctaBn: 'লাইভ দেখুন', badgeEn: 'LIVE SIM', target: '/live', accent: 'violet', sort: 30,
      },
      {
        titleEn: 'Cricket & football board', subtitleEn: 'Fixtures, markets and a working bet slip in demo mode. Live data only via a licensed provider.',
        titleBn: 'ক্রিকেট ও ফুটবল বোর্ড', subtitleBn: 'ম্যাচ, মার্কেট ও কার্যকর বেট স্লিপ (ডেমো)। লাইভ ডেটা শুধু লাইসেন্সপ্রাপ্ত প্রোভাইডারের মাধ্যমে।',
        ctaEn: 'Sports', ctaBn: 'স্পোর্টস', badgeEn: 'DEMO ODDS', target: '/sports', accent: 'emerald', sort: 40,
      },
    ];
    for (const b of banners) {
      run(
        `INSERT INTO banners(title_en, subtitle_en, cta_en, title_bn, subtitle_bn, cta_bn, badge, target, accent, sort, active)
         VALUES(:te,:se,:ce,:tb,:sb,:cb,:badge,:target,:accent,:sort,1)`,
        { te: b.titleEn, se: b.subtitleEn, ce: b.ctaEn, tb: b.titleBn, sb: b.subtitleBn, cb: b.ctaBn, badge: b.badgeEn, target: b.target, accent: b.accent, sort: b.sort }
      );
    }
    const anns = [
      { en: ['Demo mode active', 'This build uses virtual demo credits with no monetary value. Real-money wagering, deposits and withdrawals are disabled at the code level (see src/config.js).'], bn: ['ডেমো মোড চালু', 'এই বিল্ডে নগদ মূল্যহীন ভার্চুয়াল ডেমো ক্রেডিট ব্যবহার হয়। আসল টাকার বাজি, ডিপোজিট ও উত্তোলন কোড-লেভেলে নিষ্ক্রিয় (src/config.js দেখুন)।'], type: 'info' },
      { en: ['Daily demo top-up', 'If your balance drops below ৳50 the wallet is topped up once per day so testing never stalls.'], bn: ['দৈনিক ডেমো টপ-আপ', 'ব্যালেন্স ৳৫০-এর নিচে নামলে দিনে একবার ব্যালেন্স টপ-আপ হয়, যাতে টেস্টিং থেমে না যায়।'], type: 'bonus' },
      { en: ['Fairness verifier', 'Every round is derived from a committed server seed. Rotate your seed on /fairness and re-verify any past bet.'], bn: ['ন্যায্যতা যাচাই', 'প্রতিটি রাউন্ড কমিট করা সার্ভার সিড থেকে তৈরি। /fairness-এ সিড রোটেট করে যেকোনো পুরনো বাজি আবার যাচাই করুন।'], type: 'info' },
    ];
    for (const a of anns) {
      run(`INSERT INTO announcements(title_en, body_en, title_bn, body_bn, type, active) VALUES(:te,:be,:tb,:bb,:t,1)`,
        { te: a.en[0], be: a.en[1], tb: a.bn[0], bb: a.bn[1], t: a.type });
    }
  });

  // ---- users + history
  const demoUsers = [
    { email: config.admin.seedEmail, username: 'arenaplay_admin', role: 'admin', locale: 'en' },
    { email: 'demo@arenaplay.local', username: 'demo_player', role: 'user', locale: 'bn' },
    { email: 'raki@example.com', username: 'raki_bd', role: 'user', locale: 'bn' },
    { email: 'jenniferr@example.com', username: 'jennie_92', role: 'user', locale: 'en' },
    { email: 'shanto@example.com', username: 'shanto', role: 'moderator', locale: 'en' },
    { email: 'arif@example.com', username: 'arif_cricket', role: 'user', locale: 'bn' },
  ];
  const pw = hashPassword('DemoUser!2026');
  for (const [i, u] of demoUsers.entries()) {
    const existing = get(`SELECT id FROM users WHERE lower(email) = lower(:e)`, { e: u.email });
    if (existing) continue;
    const r = run(
      `INSERT INTO users(email, username, password_hash, role, locale, avatar, email_verified, created_at, last_login_at, daily_loss_limit, session_limit_min)
       VALUES(:e,:u,:p,:r,:l,:a,1,datetime('now', :c),datetime('now', :ll),:dl,:sl)`,
      {
        e: u.email, u: u.username, p: i === 0 ? hashPassword(config.admin.seedPassword) : pw, r: u.role, l: u.locale,
        a: pick(['tiger', 'lion', 'eagle', 'cobra', 'royal', 'flame']), c: `-${40 - i * 5} days`, ll: `-${i} hours`,
        dl: i % 2 ? 200000 : null, sl: i % 3 ? 60 : null,
      }
    );
    const id = Number(r.lastInsertRowid);
    ensureWallet(id);
    run(`UPDATE user_wallets SET balance = :b, lifetime_wagered = :w, lifetime_won = :won WHERE user_id = :u`,
      { b: 200000 + rng.int(900000), w: 400000 + rng.int(4000000), won: 380000 + rng.int(3900000), u: id });
    run(`INSERT INTO transactions(user_id, kind, amount, balance_after, note_key, reference, created_at)
         VALUES(:u,'bonus',(SELECT balance FROM user_wallets WHERE user_id = :u),(SELECT balance FROM user_wallets WHERE user_id = :u),'wallet.note.signup_bonus','signup:'||:u,datetime('now', :c))`,
      { u: id, c: `-${40 - i * 5} days` });
    summary.users += 1;
  }

  // ---- bet history so the dashboard and history pages show real content
  const userIds = all(`SELECT id, locale FROM users`).map((r) => r.id);
  const gameKeys = all(`SELECT key, engine, min_bet, max_bet FROM games WHERE enabled = 1`);
  if (get(`SELECT COUNT(*) c FROM bets`)?.c === 0) {
    tx(() => {
      const statuses = ['won', 'lost', 'lost', 'won', 'lost', 'cashout', 'lost', 'void'];
      for (let day = 0; day < 14; day += 1) {
        const count = 8 + rng.int(18);
        for (let i = 0; i < count; i += 1) {
          const userId = pick(userIds);
          const g = pick(gameKeys);
          if (!g || g.engine === 'crash' || g.engine === 'live') continue;
          const stake = Math.max(100, Math.round((g.min_bet + rng.int(Math.max(1, Math.round((g.max_bet - g.min_bet) / 40)))) * 10) / 10);
          const status = pick(statuses);
          const mult = status === 'won' ? 1.4 + rng.int(200) / 100 : status === 'cashout' ? 1.1 + rng.int(60) / 10 : status === 'void' ? 1 : 0;
          const payout = Math.round(stake * mult);
          const createdAt = iso(now - day * 86400_000 - rng.int(80000000));
          run(
            `INSERT INTO bets(public_id, user_id, kind, game_key, stake, currency, selection, outcome, status, payout, multiplier,
                              server_seed_hash, nonce, fair, created_at, settled_at)
             VALUES(:p,:u,'casino',:g,:s,'DEMO','{}',:o,:st,:pay,:mult,:hash,:nonce,1,:ca,:ca)`,
            {
              p: `seed${day}${i}${rng.int(99999)}`, u: userId, g: g.key, s: stake,
              o: JSON.stringify({ seededHistory: true, status }), st: status, pay: payout,
              mult: Math.round(mult * 100) / 100,
              hash: `seeded-${day}-${i}`, nonce: i + 1, ca: createdAt,
            }
          );
          summary.bets += 1;
          const dayKey = createdAt.slice(0, 10);
          run(`INSERT INTO daily_stats(day, bets, wagered, paid, wins) VALUES(:d,1,:s,:p,:w)
               ON CONFLICT(day) DO UPDATE SET bets = bets + 1, wagered = wagered + :s, paid = paid + :p, wins = wins + :w`,
            { d: dayKey, s: stake, p: payout, w: status === 'won' || status === 'cashout' ? 1 : 0 });
        }
      }
    });
  }

  // ---- a couple of support tickets + notifications so nothing looks empty
  if (get(`SELECT COUNT(*) c FROM support_tickets`)?.c === 0) {
    const uid = get(`SELECT id FROM users WHERE role = 'user' ORDER BY id LIMIT 1`)?.id;
    if (uid) {
      const ref = 'AP-DEMO01';
      run(`INSERT INTO support_tickets(ref, user_id, category, subject, status, priority, created_at, updated_at)
           VALUES(:r,:u,'limits','Can I change my daily loss limit?','open','normal',datetime('now','-4 hours'),datetime('now','-3 hours'))`, { r: ref, u: uid });
      const tid = get(`SELECT id FROM support_tickets WHERE ref = :r`, { r: ref }).id;
      run(`INSERT INTO ticket_messages(ticket_id, author_user_id, from_admin, body, created_at)
           VALUES(:t,:u,0,:b,datetime('now','-4 hours'))`, { t: tid, u: uid, b: 'I want to lower my daily loss limit from ৳2000 to ৳800. Where do I do that?' });
      run(`INSERT INTO notifications(user_id, level, icon, title_key, body_key, params, link, created_at)
           VALUES(:u,'info','chat','notif.ticket_created','notif.ticket_created_body',:p,:l,datetime('now','-3 hours'))`,
        { u: uid, p: JSON.stringify({ ref }), l: `/support/${ref}` });
      run(`INSERT INTO notifications(user_id, level, icon, title_key, params, created_at)
           VALUES(:u,'success','gift','notif.bonus_credited',:p,datetime('now','-2 days'))`,
        { u: uid, p: JSON.stringify({ amount: 500000 }) });
    }
  }

  return summary;
}

/**
 * Client-side mirrors of the engine's published tables, used only for display
 * (board colours, paytables, expected multipliers). The server recomputes and
 * validates every bet — nothing here can change an outcome.
 */
export const ROULETTE_WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const ROULETTE_RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
export const MINES_CELLS = 25;
export const WHEEL_SEGMENTS = 20;
export const WHEEL_TARGETS = [1.2, 1.5, 2, 3, 5, 10, 20, 50];
export const PLINKO_ROWS = 12;
export const PLINKO_TABLES = {
  low: [8.4, 2.9, 1.9, 1.4, 1.2, 1.1, 0.9, 1.1, 1.2, 1.4, 1.9, 2.9, 8.4],
  medium: [13, 3, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 3, 13],
  high: [24, 5.6, 2.1, 1.1, 1, 0.5, 0.1, 0.5, 1, 1.1, 2.1, 5.6, 24],
};
export const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const SEG_COLORS = ['#e3b341', '#142449', '#b5303c', '#17864f'];
export const BJ_PAY = { blackjack: 2.5, win: 2, push: 1, bust: 0 };
export const SIDES_PAYOUT = {
  baccarat: { player: 2, banker: 1.95, tie: 9, pair_player: 12, pair_banker: 12 },
  three_patti: { player: 2, tie: 9, pair_plus: 26 },
};

export const rouletteColour = (n) => (n === 0 ? 'green' : ROULETTE_RED.includes(n) ? 'red' : 'black');

/** Expected multiplier for a roulette bet type (display only; server has truth). */
export const ROULETTE_PAYS = {
  straight: 36, split: 18, street: 12, corner: 9, sixline: 6, dozen: 3, column: 3, red: 2, black: 2, odd: 2, even: 2, low: 2, high: 2,
};

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
// Plinko paytables are deliberately not duplicated here: the engine derives them
// from its row count and target return, and the board reads cfg.tables.
export const BINGO_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const SEG_COLORS = ['#e3b341', '#142449', '#b5303c', '#17864f'];
// Side-bet and blackjack payouts are owned by src/games/cards.js and served with
// the game config: a second copy here had already drifted (12:1 pairs against a
// paid 11:1, a 3-patti tie bet the table no longer offers), and an odds label the
// engine does not honour is a broken promise, not a simplification.

export const rouletteColour = (n) => (n === 0 ? 'green' : ROULETTE_RED.includes(n) ? 'red' : 'black');

/** Expected multiplier for a roulette bet type (display only; server has truth). */
// Roulette payouts live in rouletteBetPayout() on the server; the board asks the
// game config for them rather than keeping a copy that can fall out of step.

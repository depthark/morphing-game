// Shared board: every game lives on the same 15×24 grid of 8px cells.
// The canvas renders at this logical resolution and is scaled up pixelated.
export const COLS = 15;
export const ROWS = 24;
export const CELL = 8;
export const W = COLS * CELL;
export const H = ROWS * CELL;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'right', 'down', 'left'];
export const DV: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const OPP: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export type GameId = 'snake' | 'chomper' | 'bomber' | 'raid' | 'paddle' | 'flapper' | 'blocks';
export const ORDER: GameId[] = ['snake', 'chomper', 'bomber', 'raid', 'paddle', 'flapper', 'blocks'];
export const NAMES: Record<GameId, string> = {
  snake: 'SNAKE',
  chomper: 'CHOMPER',
  bomber: 'BOMBER',
  raid: 'ALIEN RAID',
  paddle: 'PADDLE',
  flapper: 'FLAPPER',
  blocks: 'BLOCKFALL',
};
export const nextOf = (id: GameId): GameId => ORDER[(ORDER.indexOf(id) + 1) % ORDER.length];

// Tile types shared by the grid-based games.
export const T = {
  EMPTY: 0,
  BORDER: 1,
  WALL: 2,
  DOOR: 3,
  HOUSE: 4,
  BRICK: 5,
  PILLAR: 6,
} as const;
export type Tile = (typeof T)[keyof typeof T];

export const idx = (c: number, r: number) => r * COLS + c;
export const inBounds = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
export const isBorder = (c: number, r: number) => c === 0 || r === 0 || c === COLS - 1 || r === ROWS - 1;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const rnd = (n: number) => Math.floor(Math.random() * n);
export const pick = <T>(a: readonly T[]): T => a[rnd(a.length)];

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Cell {
  c: number;
  r: number;
}

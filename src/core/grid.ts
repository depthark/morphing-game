import { COLS, DV, DIRS, type Dir, idx, ROWS, T, type Tile, OPP, isBorder } from './constants';

// Maze used by CHOMPER and grown by SNAKE during its morph. 15×24, symmetric,
// fully connected, no dead ends (checked in tests).
export const MAZE = [
  '###############',
  '#......#......#',
  '#o##.#.#.#.##o#',
  '#.............#',
  '#.##.#####.##.#',
  '#....#...#....#',
  '####.#.#.#.####',
  '####.......####',
  '####.##-##.####',
  '#....#GGG#....#',
  '#.##.#####.##.#',
  '#.............#',
  '#.##.#.#.#.##.#',
  '#..#.#...#.#..#',
  '##.#.##.##.#.##',
  '#....#...#....#',
  '#.##...#...##.#',
  '#.##.#####.##.#',
  '#o...........o#',
  '#.###.#.#.###.#',
  '#.....#.#.....#',
  '#.###.....###.#',
  '#......#......#',
  '###############',
];

export const HOUSE_DOOR = { c: 7, r: 8 };
export const HOUSE_EXIT = { c: 7, r: 7 };
export const HOUSE_IN = { c: 7, r: 9 };
export const CHOMPER_START = { c: 7, r: 18 };

export interface MazeData {
  tiles: Uint8Array;
  dots: Uint8Array; // 0 none, 1 dot, 2 power pellet
}

export function parseMaze(): MazeData {
  const tiles = new Uint8Array(COLS * ROWS);
  const dots = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = MAZE[r][c];
      const i = idx(c, r);
      if (ch === '#') tiles[i] = isBorder(c, r) ? T.BORDER : T.WALL;
      else if (ch === '-') tiles[i] = T.DOOR;
      else if (ch === 'G') tiles[i] = T.HOUSE;
      else if (ch === '.') dots[i] = 1;
      else if (ch === 'o') dots[i] = 2;
    }
  return { tiles, dots };
}

export function borderTiles(): Uint8Array {
  const t = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isBorder(c, r)) t[idx(c, r)] = T.BORDER;
  return t;
}

export const tileAt = (tiles: Uint8Array, c: number, r: number): Tile =>
  c < 0 || r < 0 || c >= COLS || r >= ROWS ? T.BORDER : (tiles[idx(c, r)] as Tile);

/** Entity moving tile-to-tile; (x, y) is the top-left in cells, integral when aligned. */
export interface Mover {
  x: number;
  y: number;
  dir: Dir | null;
}

const EPS = 1e-4;
export const aligned = (m: Mover) => Math.abs(m.x - Math.round(m.x)) < EPS && Math.abs(m.y - Math.round(m.y)) < EPS;

/**
 * Move `dist` cells along the grid. At each tile centre `choose` picks the next
 * direction (or null to stop); `canEnter` gates the destination tile.
 */
export function advance(
  m: Mover,
  dist: number,
  choose: (c: number, r: number) => Dir | null,
  canEnter: (c: number, r: number) => boolean,
) {
  let guard = 0;
  while (dist > EPS && guard++ < 50) {
    if (aligned(m)) {
      m.x = Math.round(m.x);
      m.y = Math.round(m.y);
      const d = choose(m.x, m.y);
      if (!d || !canEnter(m.x + DV[d][0], m.y + DV[d][1])) {
        m.dir = d && canEnter(m.x + DV[d][0], m.y + DV[d][1]) ? d : null;
        return;
      }
      m.dir = d;
    }
    if (!m.dir) return;
    const [dx, dy] = DV[m.dir];
    const pos = dx !== 0 ? m.x : m.y;
    const s = dx + dy; // ±1
    const target = s > 0 ? Math.floor(pos + EPS) + 1 : Math.ceil(pos - EPS) - 1;
    const remaining = Math.abs(target - pos);
    const step = Math.min(dist, remaining);
    if (dx !== 0) m.x = step === remaining ? target : m.x + dx * step;
    else m.y = step === remaining ? target : m.y + dy * step;
    dist -= step;
  }
}

/** Reverse in place mid-tile (classic maze-game behaviour). */
export function reverse(m: Mover) {
  if (m.dir) m.dir = OPP[m.dir];
}

export function openDirs(c: number, r: number, canEnter: (c: number, r: number) => boolean): Dir[] {
  return DIRS.filter((d) => canEnter(c + DV[d][0], r + DV[d][1]));
}

/** Tiles covered by a mover (one, or two while between tiles). */
export function coveredTiles(m: Mover): [number, number][] {
  const out: [number, number][] = [[Math.floor(m.x + EPS), Math.floor(m.y + EPS)]];
  const cx = Math.ceil(m.x - EPS);
  const cy = Math.ceil(m.y - EPS);
  if (cx !== out[0][0] || cy !== out[0][1]) out.push([cx, cy]);
  return out;
}

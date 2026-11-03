import type { GameId } from './constants';

// Every game has its own palette; during a morph the two palettes are blended
// so the whole screen slowly "re-skins" itself under the player's hands.
export interface Palette {
  bg: string;
  grid: string;
  wall: string;
  wall2: string;
  player: string;
  player2: string;
  food: string;
  accent: string;
  enemy: string;
  enemy2: string;
}
export type PalKey = keyof Palette;

export const PALETTES: Record<GameId, Palette> = {
  snake: {
    bg: '#0d1a10',
    grid: '#13261a',
    wall: '#2f6b3a',
    wall2: '#1d4426',
    player: '#8dff6a',
    player2: '#3fbf3a',
    food: '#ff4f5e',
    accent: '#ffe066',
    enemy: '#ff9f43',
    enemy2: '#ffffff',
  },
  chomper: {
    bg: '#07061a',
    grid: '#0d0b29',
    wall: '#6a4cff',
    wall2: '#2a1f80',
    player: '#b6ff4a',
    player2: '#6fbf1f',
    food: '#ffd6a5',
    accent: '#ff4f9a',
    enemy: '#ff5d5d',
    enemy2: '#ffffff',
  },
  bomber: {
    bg: '#1f3a2c',
    grid: '#24432f',
    wall: '#9aa7b4',
    wall2: '#5d6b78',
    player: '#f4f4f4',
    player2: '#4aa3ff',
    food: '#ffcf4a',
    accent: '#ff7a2f',
    enemy: '#ff9a3c',
    enemy2: '#2b1a10',
  },
  raid: {
    bg: '#02030c',
    grid: '#070a1c',
    wall: '#3cff8f',
    wall2: '#1f8f50',
    player: '#3cff8f',
    player2: '#c6ffe0',
    food: '#ffffff',
    accent: '#ff5fd7',
    enemy: '#d9d4ff',
    enemy2: '#ff5fd7',
  },
  paddle: {
    bg: '#0c0c0c',
    grid: '#161616',
    wall: '#d8d8d8',
    wall2: '#7a7a7a',
    player: '#ffffff',
    player2: '#bdbdbd',
    food: '#ffffff',
    accent: '#ffd23f',
    enemy: '#ffffff',
    enemy2: '#9a9a9a',
  },
  flapper: {
    bg: '#5ec4e8',
    grid: '#79d0ee',
    wall: '#5fbf3f',
    wall2: '#2f7f2a',
    player: '#ffd23f',
    player2: '#ff7a2f',
    food: '#ffffff',
    accent: '#ffffff',
    enemy: '#e8d9a0',
    enemy2: '#b89a5a',
  },
  blocks: {
    bg: '#0b0b1f',
    grid: '#131330',
    wall: '#4b4b8f',
    wall2: '#2b2b5c',
    player: '#ffffff',
    player2: '#9a9aff',
    food: '#ff4f5e',
    accent: '#46e0ff',
    enemy: '#ff9f43',
    enemy2: '#ffffff',
  },
};

type RGB = [number, number, number];
const cache = new Map<string, RGB>();
function hex(h: string): RGB {
  let v = cache.get(h);
  if (!v) {
    const n = parseInt(h.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(h, v);
  }
  return v;
}

export function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const x = hex(a);
  const y = hex(b);
  const r = Math.round(x[0] + (y[0] - x[0]) * t);
  const g = Math.round(x[1] + (y[1] - x[1]) * t);
  const bl = Math.round(x[2] + (y[2] - x[2]) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

export function mixPalette(a: Palette, b: Palette, t: number): Palette {
  const out = {} as Palette;
  for (const k of Object.keys(a) as PalKey[]) out[k] = mix(a[k], b[k], t);
  return out;
}

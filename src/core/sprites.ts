// 8×8 pixel sprites. 'X' = main colour, 'o' = secondary colour, 'w' = white, '.' = transparent.
// All artwork here is original.
export type Sprite = string[];

export const SPR = {
  chompOpen: [
    '..XXXX..',
    '.XXXXXX.',
    'XXXXX...',
    'XXXX....',
    'XXXX....',
    'XXXXX...',
    '.XXXXXX.',
    '..XXXX..',
  ],
  chompHalf: [
    '..XXXX..',
    '.XXXXXX.',
    'XXXXXXXX',
    'XXXXX...',
    'XXXXX...',
    'XXXXXXXX',
    '.XXXXXX.',
    '..XXXX..',
  ],
  chompClosed: [
    '..XXXX..',
    '.XXXXXX.',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    '.XXXXXX.',
    '..XXXX..',
  ],
  spook: [
    '.X....X.',
    '.XXXXXX.',
    'XXXXXXXX',
    'XwoXXwoX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'X.XX.XX.',
  ],
  spook2: [
    'X......X',
    '.XXXXXX.',
    'XXXXXXXX',
    'XwoXXwoX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    '.XX.XX.X',
  ],
  scared: [
    '.X....X.',
    '.XXXXXX.',
    'XXXXXXXX',
    'XXwXXwXX',
    'XXXXXXXX',
    'XwXwXwXX',
    'XXXXXXXX',
    'X.XX.XX.',
  ],
  eyes: [
    '........',
    '........',
    '........',
    '.wo..wo.',
    '.ww..ww.',
    '........',
    '........',
    '........',
  ],
  bomberman: [
    '..XXXX..',
    '.XXXXXX.',
    '.XooooX.',
    '.XowowX.',
    '..XXXX..',
    '.oXXXXo.',
    '..X..X..',
    '.oo..oo.',
  ],
  balloon: [
    '..XXXX..',
    '.XXXXXX.',
    'XXwoXwoX',
    'XXXXXXXX',
    'XXX..XXX',
    '.XXXXXX.',
    '..XXXX..',
    '...o....',
  ],
  bomb: [
    '......w.',
    '.....o..',
    '..XXXo..',
    '.XXXXXX.',
    '.XwXXXX.',
    '.XXXXXX.',
    '.XXXXXX.',
    '..XXXX..',
  ],
  alienA1: [
    '..X..X..',
    '...XX...',
    '..XXXX..',
    '.XoXXoX.',
    'XXXXXXXX',
    'X.XXXX.X',
    'X.X..X.X',
    '...XX...',
  ],
  alienA2: [
    '..X..X..',
    'X..XX..X',
    'X.XXXX.X',
    'XXoXXoXX',
    'XXXXXXXX',
    '..XXXX..',
    '.X....X.',
    'X......X',
  ],
  alienB1: [
    '...XX...',
    '..XXXX..',
    '.XXXXXX.',
    'XXoXXoXX',
    'XXXXXXXX',
    '.X.XX.X.',
    'X......X',
    '.X....X.',
  ],
  alienB2: [
    '...XX...',
    '..XXXX..',
    '.XXXXXX.',
    'XXoXXoXX',
    'XXXXXXXX',
    '..X..X..',
    '.X.XX.X.',
    'X.X..X.X',
  ],
  ship: [
    '...XX...',
    '...XX...',
    '..XooX..',
    '.XXXXXX.',
    'XXXXXXXX',
    'XXXXXXXX',
    'XX.XX.XX',
    '........',
  ],
  bird1: [
    '........',
    '..XXXX..',
    '.XXXXwo.',
    'oooXXXXX',
    'XoooXXoo',
    '.XXXXXX.',
    '..XXXX..',
    '........',
  ],
  bird2: [
    '........',
    '..XXXX..',
    '.XXXXwo.',
    'XXXXXXXX',
    'XoooXXoo',
    'oooXXXX.',
    '..XXXX..',
    '........',
  ],
  cherry: [
    '....o...',
    '...oo...',
    '..o..o..',
    '.o....o.',
    'XXX..XXX',
    'XwX..XwX',
    'XXX..XXX',
    '........',
  ],
  apple: [
    '....o...',
    '...o....',
    '.XX.XX..',
    'XXXXXXX.',
    'XwXXXXX.',
    'XXXXXXX.',
    '.XXXXX..',
    '..X.X...',
  ],
  flame: [
    '...X....',
    '..XX....',
    '..XoX...',
    '.XooX.X.',
    '.XowoXX.',
    'XoowooX.',
    'XoowwoX.',
    '.XXXXX..',
  ],
  plusBomb: [
    '........',
    '..XXX.o.',
    '.XXXXXo.',
    'XXwXXXX.',
    'XXXXXX..',
    'XXXXXX.o',
    '.XXXX.oo',
    '.......o',
  ],
} satisfies Record<string, Sprite>;

export type SpriteName = keyof typeof SPR;

const rotCache = new Map<Sprite, Sprite[]>();

/** Rotate a sprite 90° clockwise `times` times (memoised). */
export function rotate(s: Sprite, times: number): Sprite {
  const k = ((times % 4) + 4) % 4;
  let list = rotCache.get(s);
  if (!list) rotCache.set(s, (list = []));
  return (list[k] ??= rotateRaw(s, k));
}

function rotateRaw(s: Sprite, times: number): Sprite {
  let out = s;
  for (let t = 0; t < ((times % 4) + 4) % 4; t++) {
    const n = out.length;
    const next: string[] = [];
    for (let x = 0; x < n; x++) {
      let row = '';
      for (let y = n - 1; y >= 0; y--) row += out[y][x] ?? '.';
      next.push(row);
    }
    out = next;
  }
  return out;
}

export const flipX = (s: Sprite): Sprite => s.map((r) => [...r].reverse().join(''));

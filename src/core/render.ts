import { CELL, H, W } from './constants';
import { PALETTES, type Palette } from './palette';
import type { Sprite } from './sprites';

type Run = [x: number, y: number, len: number, ch: string];
const runCache = new WeakMap<Sprite, Run[]>();

function runs(s: Sprite): Run[] {
  let r = runCache.get(s);
  if (r) return r;
  r = [];
  s.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let len = 1;
      while (row[x + len] === ch) len++;
      r!.push([x, y, len, ch]);
      x += len;
    }
  });
  runCache.set(s, r);
  return r;
}

export interface SpriteColors {
  X: string;
  o?: string;
  w?: string;
}

/** Thin wrapper over a 2D context at the logical (120×192) resolution. */
export class Renderer {
  pal: Palette = PALETTES.snake;
  constructor(public ctx: CanvasRenderingContext2D) {}

  begin(pal: Palette, shakeX = 0, shakeY = 0) {
    this.pal = pal;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = pal.bg;
    c.fillRect(0, 0, W, H);
    c.translate(Math.round(shakeX), Math.round(shakeY));
  }

  alpha(a: number) {
    this.ctx.globalAlpha = Math.max(0, Math.min(1, a));
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** Fill a grid cell (optionally inset by `inset` pixels). */
  cell(c: number, r: number, color: string, inset = 0) {
    this.rect(c * CELL + inset, r * CELL + inset, CELL - inset * 2, CELL - inset * 2, color);
  }

  /** Bevelled block at cell coordinates (accepts fractional positions). */
  block(c: number, r: number, color: string, light = '#ffffff', dark = '#000000') {
    const x = Math.round(c * CELL);
    const y = Math.round(r * CELL);
    const ctx = this.ctx;
    const a = ctx.globalAlpha;
    this.rect(x, y, CELL, CELL, color);
    ctx.globalAlpha = a * 0.35;
    this.rect(x, y, CELL, 1, light);
    this.rect(x, y, 1, CELL, light);
    ctx.globalAlpha = a * 0.35;
    this.rect(x, y + CELL - 1, CELL, 1, dark);
    this.rect(x + CELL - 1, y, 1, CELL, dark);
    ctx.globalAlpha = a;
  }

  /** Draw an 8×8 sprite with its top-left at pixel (x, y). */
  sprite(s: Sprite, x: number, y: number, col: SpriteColors) {
    const ctx = this.ctx;
    const ox = Math.round(x);
    const oy = Math.round(y);
    for (const [rx, ry, len, ch] of runs(s)) {
      ctx.fillStyle = ch === 'X' ? col.X : ch === 'o' ? (col.o ?? col.X) : (col.w ?? '#ffffff');
      ctx.fillRect(ox + rx, oy + ry, len, 1);
    }
  }

  /** Sprite centred on cell coordinates (fractional allowed). */
  spriteAt(s: Sprite, c: number, r: number, col: SpriteColors) {
    this.sprite(s, c * CELL, r * CELL, col);
  }

  /** Square dot centred in a cell. */
  dot(c: number, r: number, size: number, color: string) {
    const x = c * CELL + (CELL - size) / 2;
    const y = r * CELL + (CELL - size) / 2;
    this.rect(x, y, size, size, color);
  }

  /** Pixel circle (for balls) centred on pixel coordinates. */
  disc(cx: number, cy: number, rad: number, color: string) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let dy = -rad; dy < rad; dy++) {
      const w = Math.round(Math.sqrt(rad * rad - (dy + 0.5) * (dy + 0.5)));
      ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
    }
  }
}

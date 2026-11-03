import { CELL, T } from '../core/constants';
import type { Renderer } from '../core/render';

export const BRICK_COLOR = '#c0703f';
export const BRICK_MORTAR = '#6b3a1f';

/** Draw a grid tile in the style of whatever palette is active. */
export function drawTile(r: Renderer, tile: number, c: number, y: number) {
  const P = r.pal;
  switch (tile) {
    case T.BORDER:
      r.block(c, y, P.wall);
      break;
    case T.WALL:
      r.cell(c, y, P.wall);
      r.cell(c, y, P.wall2, 2);
      break;
    case T.DOOR:
      r.rect(c * CELL, y * CELL + 3, CELL, 2, P.accent);
      break;
    case T.PILLAR:
      r.block(c, y, P.wall);
      r.rect(c * CELL + 2, y * CELL + 2, 4, 4, P.wall2);
      break;
    case T.BRICK:
      drawBrick(r, c, y);
      break;
  }
}

export function drawBrick(r: Renderer, c: number, y: number, color = BRICK_COLOR) {
  const x = c * CELL;
  const py = y * CELL;
  r.rect(x, py, CELL, CELL, color);
  r.rect(x, py + 3, CELL, 1, BRICK_MORTAR);
  r.rect(x, py + 7, CELL, 1, BRICK_MORTAR);
  r.rect(x + 3, py, 1, 3, BRICK_MORTAR);
  r.rect(x + 7, py + 4, 1, 3, BRICK_MORTAR);
}

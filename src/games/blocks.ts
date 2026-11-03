import { type Cell, CELL, COLS, idx, ROWS, shuffle } from '../core/constants';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import type { Renderer } from '../core/render';
import { PIECE_COLORS, WELL } from './layout';
import { type Crumb, Snake } from './snake';

// Spawn orientation of each piece (index 1..7 = I O T S Z J L) inside its box.
const BASE: Record<number, { size: number; cells: [number, number][] }> = {
  1: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  2: { size: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  3: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  4: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  5: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  6: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  7: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

/** SHAPES[type][rot] → cells; clockwise rotation (x, y) → (size-1-y, x). */
const SHAPES: Record<number, [number, number][][]> = {};
for (const k of Object.keys(BASE).map(Number)) {
  const { size, cells } = BASE[k];
  const rots = [cells];
  for (let r = 1; r < 4; r++) rots.push(k === 2 ? cells : rots[r - 1].map(([x, y]) => [size - 1 - y, x] as [number, number]));
  SHAPES[k] = rots;
}
const KICKS: [number, number][] = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [0, -1],
  [-2, 0],
  [2, 0],
  [0, 1],
];
const LINE_PTS = [0, 100, 300, 500, 800];
const DAS = 0.17;
const ARR = 0.05;
const LOCK = 0.5;

interface Piece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

export interface BlocksInit {
  stack?: Uint8Array;
  spawnFrom?: Cell;
}

/**
 * BLOCKFALL (falling-block puzzle). Milestone: clear N lines.
 * Morph → SNAKE: the falling piece comes alive as a snake, the walls dissolve
 * and the stack turns into crumbs for it to eat. Next loop is faster.
 */
export class Blocks extends Mode {
  readonly id = 'blocks' as const;
  stack: Uint8Array;
  piece!: Piece;
  bag: number[] = [];
  nextType: number;
  gravT = 0;
  lockT = 0;
  resets = 0;
  lines = 0;
  target: number;
  das = { dir: 0, t: 0 };
  dead = false;
  flashRows: { r: number; t: number }[] = [];

  constructor(ctx: Ctx, init: BlocksInit = {}) {
    super(ctx);
    this.stack = init.stack ?? new Uint8Array(COLS * ROWS);
    this.target = 4 + 2 * (ctx.round - 1);
    this.nextType = this.draw();
    this.spawn();
    if (init.spawnFrom) ctx.fx.burst(init.spawnFrom.c + 0.5, init.spawnFrom.r + 0.5, '#ffd23f', 20, 6);
  }

  level() {
    return 1 + Math.floor(this.lines / 8) + 2 * (this.ctx.round - 1);
  }

  milestone(): Milestone {
    return { cur: this.lines, target: this.target, label: 'riadky' };
  }

  hint() {
    return '← → posun · ↑/X otoč · ↓ rýchlo · SPACE drop · (tap otoč, swipe ↓ drop)';
  }
  morphHint() {
    return 'Kúsok ožil! ← ↑ → ↓';
  }

  private draw() {
    if (!this.bag.length) this.bag = shuffle([1, 2, 3, 4, 5, 6, 7]);
    return this.bag.pop()!;
  }

  private cells(p: Piece) {
    return SHAPES[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y] as [number, number]);
  }

  private fits(p: Piece) {
    for (const [c, r] of this.cells(p)) {
      if (c < WELL.left || c > WELL.right || r > WELL.bottom || r < 0) return false;
      if (r >= WELL.top && this.stack[idx(c, r)]) return false;
    }
    return true;
  }

  private spawn() {
    const type = this.nextType;
    this.nextType = this.draw();
    const size = BASE[type].size;
    this.piece = { type, rot: 0, x: WELL.left + Math.floor((WELL.right - WELL.left + 1 - size) / 2), y: type === 1 ? 0 : 1 };
    this.gravT = 0;
    this.lockT = 0;
    this.resets = 0;
    if (!this.fits(this.piece)) this.die();
  }

  private tryMove(dx: number, dy: number) {
    const n = { ...this.piece, x: this.piece.x + dx, y: this.piece.y + dy };
    if (!this.fits(n)) return false;
    this.piece = n;
    if (dx && this.grounded() && this.resets < 15) {
      this.lockT = 0;
      this.resets++;
    }
    return true;
  }

  private rotate(dir: 1 | -1) {
    const rot = (this.piece.rot + dir + 4) % 4;
    for (const [kx, ky] of KICKS) {
      const n = { ...this.piece, rot, x: this.piece.x + kx, y: this.piece.y + ky };
      if (this.fits(n)) {
        this.piece = n;
        if (this.resets < 15) {
          this.lockT = 0;
          this.resets++;
        }
        this.ctx.sfx.wall();
        return;
      }
    }
  }

  private grounded() {
    return !this.fits({ ...this.piece, y: this.piece.y + 1 });
  }

  private dropY() {
    let p = this.piece;
    while (this.fits({ ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 };
    return p.y;
  }

  update(dt: number) {
    this.t += dt;
    for (const f of this.flashRows) f.t -= dt;
    this.flashRows = this.flashRows.filter((f) => f.t > 0);
    if (this.dead || this.morphing) return;
    const input = this.ctx.input;

    // horizontal with DAS
    for (const s of input.swipes) {
      if (s === 'left') this.tryMove(-1, 0);
      else if (s === 'right') this.tryMove(1, 0);
      else if (s === 'up') this.rotate(1);
      else if (s === 'down') return this.hardDrop();
    }
    const kbLeft = input.isHeld('left');
    const kbRight = input.isHeld('right');
    const want = kbRight && !kbLeft ? 1 : kbLeft && !kbRight ? -1 : 0;
    if (want && (input.wasPressed(want > 0 ? 'right' : 'left') || this.das.dir !== want)) {
      this.das = { dir: want, t: 0 };
      this.tryMove(want, 0);
    } else if (want) {
      this.das.t += dt;
      while (this.das.t >= DAS) {
        this.tryMove(want, 0);
        this.das.t -= ARR;
      }
    } else this.das.dir = 0;

    if ((input.wasPressed('up') && input.lastSource === 'key') || input.wasPressed('rotcw')) this.rotate(1);
    if (input.wasPressed('rotccw')) this.rotate(-1);
    if (input.wasPressed('action')) {
      if (input.lastSource === 'touch') this.rotate(1);
      else return this.hardDrop();
    }
    input.dirQueue = [];

    const soft = input.isHeld('down');
    const g = Math.max(0.03, 0.75 * Math.pow(0.85, this.level() - 1));
    const interval = soft ? Math.min(g, 0.035) : g;
    if (this.grounded()) {
      this.lockT += dt;
      if (this.lockT >= LOCK) this.lock();
    } else {
      this.gravT += dt;
      while (this.gravT >= interval && !this.grounded()) {
        this.gravT -= interval;
        this.piece.y++;
        if (soft) this.ctx.addScore(1);
      }
      if (this.grounded()) this.gravT = 0;
    }
  }

  private hardDrop() {
    const y = this.dropY();
    this.ctx.addScore(2 * (y - this.piece.y));
    this.piece.y = y;
    this.ctx.fx.doShake(1.5);
    this.lock();
  }

  private lock() {
    for (const [c, r] of this.cells(this.piece)) if (r >= WELL.top) this.stack[idx(c, r)] = this.piece.type;
    this.ctx.sfx.wall();
    let n = 0;
    for (let r = WELL.bottom; r >= WELL.top; r--) {
      let full = true;
      for (let c = WELL.left; c <= WELL.right; c++) if (!this.stack[idx(c, r)]) full = false;
      if (!full) continue;
      n++;
      for (let c = WELL.left; c <= WELL.right; c++) this.ctx.fx.burst(c + 0.5, r + 0.5, PIECE_COLORS[this.stack[idx(c, r)]], 2, 4);
      for (let rr = r; rr > WELL.top; rr--) for (let c = WELL.left; c <= WELL.right; c++) this.stack[idx(c, rr)] = this.stack[idx(c, rr - 1)];
      for (let c = WELL.left; c <= WELL.right; c++) this.stack[idx(c, WELL.top)] = 0;
      this.flashRows.push({ r, t: 0.2 });
      r++; // re-check the same row after shifting
    }
    if (n) {
      this.lines += n;
      this.ctx.addScore(LINE_PTS[Math.min(4, n)] * this.level());
      this.ctx.sfx.line(n);
      if (n >= 4) this.ctx.fx.doFlash('#ffffff', 0.4);
    }
    // Once the milestone is hit the next piece is the one that comes alive.
    this.spawn();
  }

  private die() {
    this.dead = true;
    this.ctx.sfx.die();
    this.ctx.fx.doShake(5);
    this.ctx.loseLife();
  }

  respawn() {
    this.dead = false;
    this.stack.fill(0);
    this.spawn();
  }

  override ready() {
    return this.morphing && !this.dead;
  }

  next(): Mode {
    const cells = this.cells(this.piece).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const body = cells.map(([c, r]) => ({ c, r: Math.max(1, r) }));
    const crumbs: Crumb[] = [];
    this.stack.forEach((v, i) => v && crumbs.push({ c: i % COLS, r: Math.floor(i / COLS), color: PIECE_COLORS[v] }));
    const head = body[0];
    return new Snake(this.ctx, { body, dir: head.r >= ROWS - 3 ? 'up' : 'down', crumbs });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const isWall = x <= WELL.left - 1 || x >= WELL.right + 1 || y === 0 || y >= WELL.floor;
        if (isWall) r.block(x, y, x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1 ? P.wall2 : P.wall);
        else if ((x + y) % 2 === 0) r.cell(x, y, P.grid);
      }
    this.stack.forEach((v, i) => v && r.block(i % COLS, Math.floor(i / COLS), PIECE_COLORS[v]));
    for (const f of this.flashRows) {
      r.alpha(f.t / 0.2);
      r.rect(WELL.left * CELL, f.r * CELL, (WELL.right - WELL.left + 1) * CELL, CELL, '#ffffff');
      r.alpha(1);
    }

    // next piece preview, half scale, on the right wall
    r.rect((WELL.right + 1) * CELL, 1 * CELL, 2 * CELL, 2 * CELL + 2, P.bg);
    for (const [x, y] of SHAPES[this.nextType][0]) r.rect((WELL.right + 1) * CELL + x * 4, CELL + 2 + y * 4, 4, 4, PIECE_COLORS[this.nextType]);

    if (this.dead) return;
    const gy = this.dropY();
    r.alpha(0.22);
    for (const [c, y] of SHAPES[this.piece.type][this.piece.rot]) r.block(this.piece.x + c, gy + y, PIECE_COLORS[this.piece.type]);
    r.alpha(1);
    for (const [c, y] of this.cells(this.piece)) r.block(c, y, PIECE_COLORS[this.piece.type]);
  }
}

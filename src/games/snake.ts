import { type Cell, clamp01, COLS, type Dir, DV, idx, isBorder, OPP, pick, ROWS, shuffle, T } from '../core/constants';
import { parseMaze } from '../core/grid';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import { mix, PALETTES } from '../core/palette';
import type { Renderer } from '../core/render';
import { rotate, SPR } from '../core/sprites';
import { Chomper } from './chomper';
import { WELL } from './layout';

export interface Crumb extends Cell {
  color: string;
}

export interface SnakeInit {
  body?: Cell[];
  dir?: Dir;
  /** Left-over BLOCKFALL stack: the newborn snake eats it during the intro. */
  crumbs?: Crumb[];
}

type FoodKind = 'apple' | 'cherry' | 'chomp';
const ROT: Record<Dir, number> = { right: 0, down: 1, left: 2, up: 3 };

/**
 * SNAKE. Milestone: reach the target length.
 * Morph → CHOMPER: apples turn into cherries/chompers that *shrink* the snake,
 * while the maze walls fade in around it. At length 1 the head opens its mouth.
 */
export class Snake extends Mode {
  readonly id = 'snake' as const;
  body: Cell[];
  dir: Dir;
  queue: Dir[] = [];
  acc = 0;
  dead = false;
  food: (Cell & { kind: FoodKind }) | null = null;
  target: number;

  // morph state
  maze = parseMaze();
  wallState = new Uint8Array(COLS * ROWS); // 0 none, 1 fading in (passable), 2 solid
  wallFade = new Float32Array(COLS * ROWS);
  wallOrder: number[] = [];
  wallRevealed = 0;
  wallSolid = 0;
  dotOrder: number[] = [];
  dotRevealed = 0;
  dots = new Uint8Array(COLS * ROWS);
  startLen = 10;

  // intro state (coming from BLOCKFALL)
  crumbs: Crumb[];
  crumbTotal: number;
  introP: number;

  constructor(ctx: Ctx, init: SnakeInit = {}) {
    super(ctx);
    this.body = init.body ?? [
      { c: 7, r: 16 },
      { c: 7, r: 17 },
      { c: 7, r: 18 },
    ];
    this.dir = init.dir ?? 'up';
    this.crumbs = init.crumbs ?? [];
    this.crumbTotal = this.crumbs.length;
    this.introP = this.crumbs.length ? 0 : 1;
    this.target = Math.min(16, 10 + 2 * (ctx.round - 1));
    this.spawnFood();
  }

  interval() {
    const base = Math.max(0.06, 0.14 / this.ctx.speed);
    // Slow right down while the maze grows: tighter corridors need more time to steer.
    return this.morphing ? base * 1.6 : base;
  }

  targetLen() {
    return Math.max(1, Math.round(this.startLen - (this.startLen - 1) * this.p));
  }

  override blend() {
    if (this.introP < 1) return { a: 'blocks' as const, b: 'snake' as const, t: this.introP };
    return super.blend();
  }

  override canMorph() {
    return !this.morphing && this.introP >= 1 && !this.dead;
  }

  milestone(): Milestone {
    if (this.introP < 1) return { cur: this.crumbTotal - this.crumbs.length, target: this.crumbTotal, label: 'crumbs' };
    if (this.morphing) return { cur: this.startLen - this.body.length, target: this.startLen - 1, label: 'cherries' };
    return { cur: this.body.length, target: this.target, label: 'length' };
  }

  hint() {
    return '← ↑ → ↓ / swipe · steer';
  }
  morphHint() {
    return 'Eat cherries and shrink to 1\nwalls can’t kill you now';
  }

  protected override onMorphStart() {
    this.startLen = Math.max(2, this.body.length);
    const walls: number[] = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++) {
        const t = this.maze.tiles[idx(c, r)];
        if (t === T.WALL || t === T.DOOR) walls.push(idx(c, r));
      }
    // Outside-in with jitter so the maze "grows" from the frame.
    const key = new Map<number, number>();
    for (const i of walls) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      key.set(i, Math.min(c, COLS - 1 - c, r, ROWS - 1 - r) + Math.random() * 2.5);
    }
    this.wallOrder = walls.sort((a, b) => key.get(a)! - key.get(b)!);
    const dots: number[] = [];
    this.maze.dots.forEach((d, i) => d && dots.push(i));
    this.dotOrder = shuffle(dots);
    if (this.food) this.food.kind = 'cherry';
  }

  update(dt: number) {
    this.t += dt;
    if (this.dead) return;
    const input = this.ctx.input;
    let d: Dir | undefined;
    while ((d = input.takeDir())) {
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (d !== last && d !== OPP[last] && this.queue.length < 3) this.queue.push(d);
    }

    if (this.introP < 1) {
      this.introP = Math.min(1, this.introP + dt / 22);
      if (!this.crumbs.length) this.introP = 1;
      if (this.introP >= 1) this.finishIntro();
    }

    if (this.morphing) {
      this.advance(dt / 45);
      this.updateWalls(dt);
      this.revealDots();
      this.shrinkTo(this.targetLen());
    }

    this.acc += dt;
    const iv = this.interval();
    while (this.acc >= iv && !this.dead) {
      this.acc -= iv;
      this.step();
    }
  }

  private finishIntro() {
    for (const cr of this.crumbs) this.ctx.fx.burst(cr.c + 0.5, cr.r + 0.5, cr.color, 3, 4);
    this.crumbs = [];
    this.spawnFood();
  }

  private step() {
    if (this.queue.length) this.dir = this.queue.shift()!;
    const h = this.body[0];
    if (this.morphing) this.autoSteer(h);
    const [dx, dy] = DV[this.dir];
    const n = { c: h.c + dx, r: h.r + dy };
    if (this.blocked(n.c, n.r)) return this.die();
    this.body.unshift(n);

    let grow = false;
    let ate = false;
    const fx = this.ctx.fx;
    if (this.food && this.food.c === n.c && this.food.r === n.r) {
      ate = true;
      if (this.food.kind === 'apple') {
        grow = true;
        this.ctx.addScore(10);
        this.ctx.sfx.eat();
        fx.burst(n.c + 0.5, n.r + 0.5, PALETTES.snake.food, 8, 5);
      } else {
        this.ctx.addScore(50);
        this.ctx.sfx.bonus();
        this.advance(1 / (this.startLen - 1));
        fx.burst(n.c + 0.5, n.r + 0.5, PALETTES.chomper.player, 12, 6);
      }
      this.food = null;
    }
    if (!grow) this.body.pop();
    if (ate) this.spawnFood();

    const i = idx(n.c, n.r);
    if (this.dots[i]) {
      this.ctx.addScore(this.dots[i] === 2 ? 20 : 5);
      this.dots[i] = 0;
      this.ctx.sfx.dot();
    }
    if (this.crumbs.length) {
      const k = this.crumbs.findIndex((cr) => cr.c === n.c && cr.r === n.r);
      if (k >= 0) {
        const [cr] = this.crumbs.splice(k, 1);
        this.ctx.addScore(5);
        this.ctx.sfx.dot();
        fx.burst(n.c + 0.5, n.r + 0.5, cr.color, 5, 4);
        this.introP = Math.min(1, this.introP + 0.6 / Math.max(1, this.crumbTotal));
        if (!this.crumbs.length) {
          this.introP = 1;
          this.finishIntro();
        }
      }
    }
    if (this.morphing) this.shrinkTo(this.targetLen());
  }

  /**
   * Mild morph: instead of crashing into a wall, turn into the free side
   * (the one with more open space ahead). Only the body can still kill you.
   */
  private autoSteer(h: Cell) {
    const isWall = (c: number, r: number) => isBorder(c, r) || this.wallState[idx(c, r)] === 2;
    const [dx, dy] = DV[this.dir];
    if (!isWall(h.c + dx, h.r + dy)) return;
    const room = (d: Dir) => {
      let n = 0;
      let c = h.c;
      let r = h.r;
      while (n < 20) {
        c += DV[d][0];
        r += DV[d][1];
        if (this.blocked(c, r)) break;
        n++;
      }
      return n;
    };
    const sides = (['up', 'down', 'left', 'right'] as Dir[]).filter((d) => d !== this.dir && d !== OPP[this.dir] && room(d) > 0);
    if (!sides.length) return;
    this.dir = sides.sort((a, b) => room(b) - room(a))[0];
    this.queue = [];
  }

  private blocked(c: number, r: number) {
    if (isBorder(c, r)) return true;
    if (this.wallState[idx(c, r)] === 2) return true;
    for (let k = 0; k < this.body.length - 1; k++) if (this.body[k].c === c && this.body[k].r === r) return true;
    return false;
  }

  private die() {
    this.dead = true;
    const h = this.body[0];
    this.ctx.sfx.die();
    this.ctx.fx.burst(h.c + 0.5, h.r + 0.5, PALETTES.snake.player, 24, 8);
    this.ctx.fx.doShake(4);
    this.ctx.loseLife();
  }

  private shrinkTo(len: number) {
    while (this.body.length > len) {
      const t = this.body.pop()!;
      this.ctx.fx.burst(t.c + 0.5, t.r + 0.5, PALETTES.snake.player, 4, 3);
    }
  }

  private occupied(i: number) {
    return this.body.some((b) => idx(b.c, b.r) === i);
  }

  private updateWalls(dt: number) {
    const want = Math.floor(clamp01(this.p * 1.2) * this.wallOrder.length);
    while (this.wallRevealed < want) {
      const i = this.wallOrder[this.wallRevealed++];
      this.wallState[i] = 1;
      this.wallFade[i] = 1.2;
    }
    const h = this.body[0];
    for (let k = 0; k < this.wallRevealed; k++) {
      const i = this.wallOrder[k];
      if (this.wallState[i] !== 1) continue;
      this.wallFade[i] -= dt;
      if (this.wallFade[i] > 0) continue;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      if (this.occupied(i) || Math.abs(c - h.c) + Math.abs(r - h.r) <= 2) continue;
      this.wallState[i] = 2;
      this.wallSolid++;
      if (this.food && idx(this.food.c, this.food.r) === i) {
        this.food = null;
        this.spawnFood();
      }
    }
  }

  private revealDots() {
    const want = Math.floor(clamp01((this.p - 0.25) / 0.65) * this.dotOrder.length);
    while (this.dotRevealed < want) {
      const i = this.dotOrder[this.dotRevealed++];
      if (!this.occupied(i)) this.dots[i] = this.maze.dots[i];
    }
  }

  private spawnFood() {
    if (this.introP < 1 || this.food) return;
    const opts: Cell[] = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++) {
        const i = idx(c, r);
        if (this.wallState[i] || this.occupied(i)) continue;
        if (this.morphing && this.maze.tiles[i] !== T.EMPTY) continue;
        opts.push({ c, r });
      }
    if (!opts.length) return;
    const p = pick(opts);
    this.food = { ...p, kind: this.morphing ? (Math.random() < 0.5 ? 'cherry' : 'chomp') : 'apple' };
  }

  respawn() {
    this.dead = false;
    this.queue = [];
    this.acc = 0;
    this.ctx.input.clearBuffers();
    if (!this.morphing) {
      this.body = [
        { c: 7, r: 16 },
        { c: 7, r: 17 },
        { c: 7, r: 18 },
      ];
      this.dir = 'up';
    } else {
      // Respawn in an open maze corridor, segments stacked so it unfolds.
      const L = this.targetLen();
      const opts: { c: number; r: number; d: Dir }[] = [];
      for (let r = 1; r < ROWS - 1; r++)
        for (let c = 1; c < COLS - 1; c++) {
          if (this.maze.tiles[idx(c, r)] !== T.EMPTY) continue;
          for (const d of ['left', 'right', 'up', 'down'] as Dir[]) {
            const [dx, dy] = DV[d];
            const ok = [1, 2].every((k) => {
              const cc = c + dx * k;
              const rr = r + dy * k;
              return !isBorder(cc, rr) && this.maze.tiles[idx(cc, rr)] === T.EMPTY;
            });
            if (ok) opts.push({ c, r, d });
          }
        }
      const s = opts.length ? pick(opts) : { c: 7, r: 18, d: 'left' as Dir };
      this.body = Array.from({ length: L }, () => ({ c: s.c, r: s.r }));
      this.dir = s.d;
    }
    if (this.food && this.occupied(idx(this.food.c, this.food.r))) this.food = null;
    this.spawnFood();
  }

  override ready() {
    return this.morphing && this.p >= 1 && this.body.length === 1 && this.wallSolid === this.wallOrder.length && !this.dead;
  }

  next(): Mode {
    for (const i of this.wallOrder) this.wallState[i] = 2;
    // Any dots not yet revealed appear now.
    for (const i of this.dotOrder) if (!this.occupied(i) && this.dotRevealed < this.dotOrder.length) this.dots[i] = this.maze.dots[i];
    const h = this.body[0];
    return new Chomper(this.ctx, { tiles: this.maze.tiles, dots: this.dots, start: { c: h.c, r: h.r }, dir: this.dir });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        if (isBorder(x, y)) r.block(x, y, P.wall);
        else if (this.wallState[i] === 2) r.block(x, y, P.wall);
        else if (this.wallState[i] === 1) {
          r.alpha(0.2 + 0.15 * Math.sin(this.t * 14 + i));
          r.block(x, y, P.wall);
          r.alpha(1);
        } else if ((x + y) % 2 === 0) r.cell(x, y, P.grid);
      }

    if (this.introP < 1) {
      // BLOCKFALL well walls dissolving.
      r.alpha(1 - this.introP);
      for (let y = WELL.top; y <= WELL.floor; y++) {
        r.block(WELL.left - 1, y, PALETTES.blocks.wall);
        r.block(WELL.right + 1, y, PALETTES.blocks.wall);
      }
      for (let x = WELL.left; x <= WELL.right; x++) r.block(x, WELL.floor, PALETTES.blocks.wall);
      r.alpha(1);
      for (const cr of this.crumbs) r.block(cr.c, cr.r, mix(cr.color, P.food, this.introP * 0.6));
    }

    this.dots.forEach((d, i) => {
      if (!d) return;
      const c = i % COLS;
      const y = Math.floor(i / COLS);
      if (d === 1) r.dot(c, y, 2, PALETTES.chomper.food);
      else if (Math.floor(this.t * 4) % 2 === 0) r.dot(c, y, 4, PALETTES.chomper.food);
    });

    if (this.food) {
      const f = this.food;
      if (f.kind === 'apple') r.spriteAt(SPR.apple, f.c, f.r, { X: P.food, o: P.player2 });
      else if (f.kind === 'cherry') r.spriteAt(SPR.cherry, f.c, f.r, { X: P.food, o: P.player2 });
      else {
        const s = Math.floor(this.t * 6) % 2 ? SPR.chompOpen : SPR.chompClosed;
        r.spriteAt(s, f.c, f.r, { X: PALETTES.chomper.player });
      }
    }

    if (this.dead && Math.floor(this.t * 10) % 2) return;
    for (let k = this.body.length - 1; k >= 1; k--) {
      const b = this.body[k];
      r.cell(b.c, b.r, k % 2 ? P.player : P.player2, 1);
    }
    const h = this.body[0];
    const becoming = this.morphing && this.body.length <= 2 && this.p > 0.7;
    if (becoming) {
      const open = Math.floor(this.t * 8) % 2 === 0;
      const s = rotate(open ? SPR.chompOpen : SPR.chompHalf, ROT[this.dir]);
      r.spriteAt(s, h.c, h.r, { X: mix(P.player, PALETTES.chomper.player, (this.p - 0.7) / 0.3) });
    } else {
      r.cell(h.c, h.r, P.player);
      const [dx, dy] = DV[this.dir];
      const cx = h.c * 8 + 4 + dx * 2;
      const cy = h.r * 8 + 4 + dy * 2;
      const ex = dy !== 0 ? 2 : 0;
      const ey = dx !== 0 ? 2 : 0;
      r.rect(cx - ex - (dy !== 0 ? 1 : 0), cy - ey - (dx !== 0 ? 1 : 0), 1, 1, P.bg);
      r.rect(cx + ex, cy + ey, 1, 1, P.bg);
    }
  }
}

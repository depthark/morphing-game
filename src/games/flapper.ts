import { CELL, clamp01, COLS, idx, lerp, rnd, ROWS } from '../core/constants';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import { PALETTES } from '../core/palette';
import type { Renderer } from '../core/render';
import { SPR } from '../core/sprites';
import { Blocks } from './blocks';
import { PIECE_COLORS, WELL } from './layout';
import { drawPipe } from './paddle';

export const BIRD_X = 4;
export const GROUND_Y = 22;
export const PIPE_W = 2;
const GRAV = 44;
const FLAP_V = -12.5;
const BIRD_R = 0.32;
const MAX_STACK = 5;

export interface Pipe {
  x: number;
  gapY: number;
  gapH: number;
  passed: boolean;
  crumbleAt?: number;
}
export interface FlapperInit {
  x: number;
  y: number;
  vy: number;
  pipes: Pipe[];
}
interface Falling {
  c: number;
  y: number;
  vy: number;
  color: number;
}

/**
 * FLAPPER (one-button flyer). Milestone: pass N pipes.
 * Morph → BLOCKFALL: pipes slow down and crumble into blocks that tumble into
 * a well that rises around the screen; the bird is no longer hurt by pipes.
 */
export class Flapper extends Mode {
  readonly id = 'flapper' as const;
  x: number;
  y: number;
  vy: number;
  waiting = false;
  pipes: Pipe[];
  nextPipe = 4;
  passed = 0;
  target: number;
  dead = false;
  flapT = 0;
  clouds = Array.from({ length: 4 }, (_, k) => ({ x: k * 4.5 + Math.random() * 2, y: 2 + Math.random() * 9 }));
  scroll = 0;

  // morph
  falling: Falling[] = [];
  stack = new Uint8Array(COLS * ROWS);

  constructor(ctx: Ctx, init: FlapperInit) {
    super(ctx);
    this.x = init.x;
    this.y = Math.min(init.y, GROUND_Y - 2);
    this.vy = init.vy;
    this.pipes = init.pipes;
    this.target = 8 + 2 * (ctx.round - 1);
    this.invuln = 1;
  }

  speed() {
    const base = 4.2 * Math.min(this.ctx.speed, 1.4);
    return this.morphing ? lerp(base, 0, clamp01(this.p * 1.25)) : base;
  }

  milestone(): Milestone {
    if (this.morphing) return { cur: Math.round(this.p * 100), target: 100, label: 'collapse' };
    return { cur: this.passed, target: this.target, label: 'pipes' };
  }

  hint() {
    return 'SPACE / ↑ / tap = flap';
  }
  morphHint() {
    return 'The pipes are crumbling into the well…';
  }

  update(dt: number) {
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dead) return;
    const input = this.ctx.input;
    const flap = input.wasPressed('action') || input.wasPressed('up') || input.wasPressed('rotcw');
    if (flap) {
      this.vy = FLAP_V;
      this.waiting = false;
      this.flapT = 0.15;
      this.ctx.sfx.flap();
    }
    this.flapT = Math.max(0, this.flapT - dt);
    this.x += (BIRD_X - this.x) * Math.min(1, dt * 2);

    if (this.waiting) {
      this.y += Math.sin(this.t * 5) * dt * 1.2;
      return;
    }

    this.vy = Math.min(16, this.vy + GRAV * dt);
    this.y += this.vy * dt;
    if (this.y < 0.4) {
      this.y = 0.4;
      this.vy = 0;
    }

    const sp = this.speed();
    this.scroll += sp * dt;
    for (const c of this.clouds) {
      c.x -= sp * 0.25 * dt;
      if (c.x < -3) c.x = COLS + Math.random() * 3;
    }
    for (const pp of this.pipes) {
      pp.x -= sp * dt;
      if (!pp.passed && pp.x + PIPE_W < this.x - BIRD_R) {
        pp.passed = true;
        this.passed++;
        this.ctx.addScore(50);
        this.ctx.sfx.dot();
      }
    }
    this.pipes = this.pipes.filter((pp) => pp.x > -PIPE_W - 0.5);

    if (!this.morphing) {
      this.nextPipe -= sp * dt;
      if (this.nextPipe <= 0) {
        this.nextPipe = 7.5;
        const gapH = Math.max(5, 7 - 0.5 * (this.ctx.round - 1));
        const gapY = 2.5 + Math.random() * (GROUND_Y - 2.5 - gapH - 1.5);
        this.pipes.push({ x: COLS + 0.5, gapY, gapH, passed: false });
      }
    }

    if (this.morphing) this.updateMorph(dt);
    else if (this.collides()) return this.die();
  }

  private collides() {
    if (this.y + BIRD_R >= GROUND_Y) return true;
    if (this.invuln > 0) return false;
    for (const pp of this.pipes) {
      if (this.x + BIRD_R > pp.x && this.x - BIRD_R < pp.x + PIPE_W) {
        if (this.y - BIRD_R < pp.gapY || this.y + BIRD_R > pp.gapY + pp.gapH) return true;
      }
    }
    return false;
  }

  private die() {
    this.dead = true;
    this.ctx.sfx.die();
    this.ctx.fx.burst(this.x, this.y, PALETTES.flapper.player, 22, 7);
    this.ctx.fx.doShake(4);
    this.ctx.loseLife();
  }

  respawn() {
    this.dead = false;
    this.y = 10;
    this.vy = 0;
    this.x = BIRD_X;
    this.waiting = !this.morphing;
    this.invuln = 1.2;
    this.pipes = this.pipes.filter((pp) => pp.x > BIRD_X + 5);
    this.nextPipe = Math.max(this.nextPipe, 3);
  }

  // ---------------------------------------------------------------- morph
  protected override onMorphStart() {
    // Every pipe currently on screen gets a crumble time; more arrive until p≈0.35.
    this.pipes.forEach((pp, k) => (pp.crumbleAt = 0.15 + k * 0.12));
  }

  private stackTop(c: number) {
    for (let r = WELL.top; r <= WELL.bottom; r++) if (this.stack[idx(c, r)]) return r;
    return WELL.floor;
  }

  private updateMorph(dt: number) {
    this.advance(dt / 18);
    // a few more pipes keep coming early in the morph
    if (this.p < 0.35) {
      this.nextPipe -= this.speed() * dt;
      if (this.nextPipe <= 0) {
        this.nextPipe = 7.5;
        this.pipes.push({ x: COLS + 0.5, gapY: 4 + Math.random() * 8, gapH: 8, passed: false, crumbleAt: this.p + 0.25 });
      }
    }
    for (const pp of [...this.pipes]) {
      if ((pp.crumbleAt ?? 0.8) > this.p && this.p < 0.85) continue;
      this.crumble(pp);
      this.pipes.splice(this.pipes.indexOf(pp), 1);
    }

    for (const f of this.falling) {
      f.vy = Math.min(20, f.vy + 35 * dt);
      f.y += f.vy * dt;
      const top = this.stackTop(f.c);
      if (f.y + 1 >= top) {
        const row = top - 1;
        if (row >= WELL.floor - MAX_STACK) {
          this.stack[idx(f.c, row)] = f.color;
          this.ctx.sfx.wall();
        } else this.ctx.fx.burst(f.c + 0.5, f.y + 0.5, PIECE_COLORS[f.color], 4, 3);
        f.y = 99;
      }
    }
    this.falling = this.falling.filter((f) => f.y < 90);
    this.clearFullRows();

    // the ground / stack bounces the bird instead of killing it
    const c = Math.floor(this.x);
    const top = c >= WELL.left && c <= WELL.right ? this.stackTop(c) : GROUND_Y;
    if (this.y + BIRD_R >= top) {
      this.y = top - BIRD_R;
      this.vy = FLAP_V * 0.8;
      this.ctx.sfx.wall();
    }
  }

  private crumble(pp: Pipe) {
    const c0 = Math.round(pp.x);
    for (let c = c0; c < c0 + PIPE_W; c++) {
      for (let r = 0; r < GROUND_Y; r++) {
        if (r >= pp.gapY && r < pp.gapY + pp.gapH) continue;
        if (c < WELL.left || c > WELL.right || Math.random() < 0.55) {
          if (Math.random() < 0.3) this.ctx.fx.burst(c + 0.5, r + 0.5, PALETTES.flapper.wall, 2, 3);
          continue;
        }
        this.falling.push({ c, y: r, vy: -Math.random() * 3, color: 1 + rnd(7) });
      }
    }
    this.ctx.sfx.pop();
  }

  private clearFullRows() {
    for (let r = WELL.bottom; r >= WELL.top; r--) {
      let full = true;
      for (let c = WELL.left; c <= WELL.right; c++) if (!this.stack[idx(c, r)]) full = false;
      if (!full) continue;
      for (let c = WELL.left; c <= WELL.right; c++) this.stack[idx(c, r)] = 0;
      this.ctx.addScore(100);
      this.ctx.sfx.line(1);
    }
  }

  override ready() {
    return this.morphing && this.p >= 1 && !this.falling.length && !this.pipes.length && !this.dead;
  }

  next(): Mode {
    return new Blocks(this.ctx, { stack: this.stack, spawnFrom: { c: Math.floor(this.x), r: Math.floor(this.y) } });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (const c of this.clouds) {
      r.alpha(0.55 * (this.morphing ? 1 - this.p : 1));
      r.rect(c.x * CELL, c.y * CELL, 20, 5, '#ffffff');
      r.rect(c.x * CELL + 4, c.y * CELL - 3, 10, 4, '#ffffff');
      r.alpha(1);
    }
    for (const pp of this.pipes) drawPipe(r, pp);

    // ground with scrolling stripes
    r.rect(0, GROUND_Y * CELL, COLS * CELL, (ROWS - GROUND_Y) * CELL, P.enemy);
    r.rect(0, GROUND_Y * CELL, COLS * CELL, 2, P.wall);
    const off = Math.floor(this.scroll * CELL) % 8;
    for (let x = -off; x < COLS * CELL; x += 8) r.rect(x, GROUND_Y * CELL + 4, 4, 2, P.enemy2);

    if (this.morphing) {
      // well walls rise from the ground
      const h = Math.floor(clamp01(this.p * 1.3) * (WELL.floor - WELL.top + 1));
      for (let k = 0; k < h; k++) {
        const y = WELL.floor - k;
        r.block(WELL.left - 1, y, PALETTES.blocks.wall);
        r.block(WELL.right + 1, y, PALETTES.blocks.wall);
      }
      r.alpha(clamp01(this.p * 2));
      for (let c = WELL.left; c <= WELL.right; c++) r.block(c, WELL.floor, PALETTES.blocks.wall);
      r.alpha(1);
      this.stack.forEach((v, i) => v && r.block(i % COLS, Math.floor(i / COLS), PIECE_COLORS[v]));
      for (const f of this.falling) r.block(f.c, f.y, PIECE_COLORS[f.color]);
    }

    if (this.dead && Math.floor(this.t * 10) % 2) return;
    if (this.invuln > 0 && Math.floor(this.t * 12) % 2) return;
    const s = this.flapT > 0 || this.vy < -3 ? SPR.bird2 : SPR.bird1;
    r.sprite(s, this.x * CELL - 4, this.y * CELL - 4, { X: P.player, o: P.player2, w: '#ffffff' });
    if (this.waiting && Math.floor(this.t * 2) % 2) r.rect(this.x * CELL - 1, (this.y - 1.4) * CELL, 3, 3, '#ffffff');
  }
}

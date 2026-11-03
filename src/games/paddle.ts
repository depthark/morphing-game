import { CELL, clamp, clamp01, COLS, lerp } from '../core/constants';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import { mix, PALETTES } from '../core/palette';
import type { Renderer } from '../core/render';
import { SPR } from '../core/sprites';
import { Flapper, BIRD_X, GROUND_Y, PIPE_W, type Pipe } from './flapper';

export const PADDLE_Y = 22; // top of the player's paddle
export const AI_Y = 1.5; // top of the opponent's paddle
const PH = 0.5; // paddle thickness
const BALL_R = 0.25;
const LEFT = 1;
const RIGHT = COLS - 1;
const PW = 4; // player paddle width in cells
const MAX_SPEED = 15;
const CPU_PER_LIFE = 3;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface PaddleInit {
  playerX: number;
  ball: Ball | null;
}

/**
 * PADDLE (vertical table tennis vs. CPU). Milestone: score N points.
 * Morph → FLAPPER: gravity seeps into the ball, SPACE / tap gives it a flap,
 * the opponent's paddle breaks into pipes and your paddle sinks into the ground.
 */
export class Paddle extends Mode {
  readonly id = 'paddle' as const;
  px: number;
  ax = COLS / 2;
  aiErr = 0;
  ball: Ball;
  serveT = 0;
  points = 0;
  /** CPU points; every CPU_PER_LIFE of them costs a life. */
  cpu = 0;
  target: number;
  speed0: number;
  dead = false;

  // morph
  pipes: Pipe[] = [];
  pipeT = 0;
  passed = 0;
  flapT = 0;

  constructor(ctx: Ctx, init: PaddleInit) {
    super(ctx);
    this.px = init.playerX;
    this.speed0 = 7 * Math.min(ctx.speed, 1.5);
    this.target = 5 + Math.floor((ctx.round - 1) / 2);
    if (init.ball) {
      this.ball = { ...init.ball };
      this.ball.vx = clamp(this.ball.vx, -5, 5);
      this.ball.vy = this.ball.vy > 0 ? this.speed0 * 0.8 : -this.speed0 * 0.8;
    } else {
      this.ball = { x: COLS / 2, y: 12, vx: 0, vy: 0 };
      this.serve();
    }
  }

  pw() {
    return this.morphing ? lerp(PW, 1.5, this.p) : PW;
  }
  aw() {
    return this.morphing ? Math.max(0, 3 * (1 - this.p * 2.5)) : 3;
  }

  milestone(): Milestone {
    if (this.morphing) return { cur: this.passed, target: 6, label: 'pipes' };
    return { cur: this.points, target: this.target, label: `CPU ${this.cpu}/${CPU_PER_LIFE} · points` };
  }

  hint() {
    return this.morphing ? 'SPACE / ↑ / tap = flap · ← → paddle' : '← → / drag · hit the ball back';
  }
  morphHint() {
    return 'The ball is falling. SPACE / tap = flap!';
  }

  private serve() {
    this.serveT = 0.9;
    const a = (Math.random() - 0.5) * 0.9;
    this.ball = { x: COLS / 2, y: 12, vx: Math.sin(a) * this.speed0, vy: Math.cos(a) * this.speed0 };
  }

  update(dt: number) {
    this.t += dt;
    if (this.dead) return;
    const input = this.ctx.input;

    // player paddle
    if (input.pointerX !== null) this.px = input.pointerX;
    else this.px += input.axisX() * 13 * dt;
    const hw = this.pw() / 2;
    this.px = clamp(this.px, LEFT + hw, RIGHT - hw);

    if (this.morphing) this.updateMorph(dt);

    if (this.serveT > 0) {
      this.serveT -= dt;
      this.moveAi(dt);
      return;
    }

    const b = this.ball;
    const g = this.morphing ? 30 * this.p : 0;
    b.vy += g * dt;
    if (this.morphing) {
      b.vx += (BIRD_X - b.x) * 3 * this.p * dt;
      b.vx *= Math.exp(-this.p * 1.5 * dt);
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x - BALL_R < LEFT) {
      b.x = LEFT + BALL_R;
      b.vx = Math.abs(b.vx);
      this.ctx.sfx.wall();
    } else if (b.x + BALL_R > RIGHT) {
      b.x = RIGHT - BALL_R;
      b.vx = -Math.abs(b.vx);
      this.ctx.sfx.wall();
    }

    // player paddle
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y - BALL_R <= PADDLE_Y + PH && Math.abs(b.x - this.px) <= hw + BALL_R) {
      const off = clamp((b.x - this.px) / hw, -1, 1);
      const sp = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * 1.03);
      const a = off * 0.9;
      b.vx = Math.sin(a) * sp;
      b.vy = -Math.cos(a) * sp;
      b.y = PADDLE_Y - BALL_R;
      // The CPU aims sloppier the more you hit it.
      this.aiErr = (Math.random() - 0.5) * 2 * (2 + 0.5 * Math.min(4, this.points));
      this.ctx.sfx.hit();
      this.ctx.fx.burst(b.x, b.y, PALETTES.paddle.player, 4, 3);
    }
    // AI paddle
    const ahw = this.aw() / 2;
    if (ahw > 0 && b.vy < 0 && b.y - BALL_R <= AI_Y + PH && b.y + BALL_R >= AI_Y && Math.abs(b.x - this.ax) <= ahw + BALL_R) {
      const off = clamp((b.x - this.ax) / ahw, -1, 1);
      const sp = Math.min(MAX_SPEED, Math.hypot(b.vx, b.vy) * 1.02);
      const a = off * 0.9;
      b.vx = Math.sin(a) * sp;
      b.vy = Math.cos(a) * sp;
      b.y = AI_Y + PH + BALL_R;
      this.ctx.sfx.hit();
    }

    this.moveAi(dt);

    if (this.morphing) {
      if (b.y < 0.5) {
        b.y = 0.5;
        b.vy = Math.abs(b.vy) * 0.5;
      }
      if (b.y > GROUND_Y - BALL_R) {
        // the ground is a trampoline while morphing
        b.y = GROUND_Y - BALL_R;
        b.vy = -11;
        this.ctx.sfx.wall();
      }
      return;
    }
    if (b.y < -0.5) {
      this.points++;
      this.ctx.addScore(100);
      this.ctx.sfx.bonus();
      this.ctx.fx.doFlash(PALETTES.paddle.player, 0.25);
      this.serve();
    } else if (b.y > 24.5) {
      this.cpu++;
      if (this.cpu >= CPU_PER_LIFE) {
        this.cpu = 0;
        this.dead = true;
        this.ctx.sfx.die();
        this.ctx.loseLife();
      } else {
        this.ctx.sfx.wall();
        this.ctx.fx.doFlash('#ff3040', 0.2);
        this.ctx.toast(`CPU point ${this.cpu}/${CPU_PER_LIFE}`);
        this.serve();
      }
    }
  }

  private moveAi(dt: number) {
    if (this.morphing && this.p > 0.2) return;
    const b = this.ball;
    let tx = COLS / 2;
    if (b.vy < 0 && this.serveT <= 0) {
      // predict where the ball reaches the AI line, folding wall bounces
      const t = (b.y - (AI_Y + PH)) / -b.vy;
      let x = b.x + b.vx * t - LEFT;
      const span = RIGHT - LEFT;
      x = ((x % (2 * span)) + 2 * span) % (2 * span);
      if (x > span) x = 2 * span - x;
      tx = x + LEFT + this.aiErr;
    }
    const maxV = 4.5 + 1 * (this.ctx.round - 1);
    const d = tx - this.ax;
    this.ax += clamp(d, -maxV * dt, maxV * dt);
    this.ax = clamp(this.ax, LEFT + 1.5, RIGHT - 1.5);
  }

  respawn() {
    this.dead = false;
    this.serve();
  }

  // ---------------------------------------------------------------- morph
  private updateMorph(dt: number) {
    this.advance(dt / 22);
    const input = this.ctx.input;
    if (input.wasPressed('action') || input.wasPressed('up') || input.wasPressed('rotcw')) {
      this.ball.vy = lerp(this.ball.vy, -10, clamp01(0.35 + this.p));
      this.flapT = 0.15;
      this.ctx.sfx.flap();
      if (this.serveT > 0) this.serveT = 0;
    }
    this.flapT = Math.max(0, this.flapT - dt);

    // pipes start streaming in, gaps shrink as the morph progresses
    this.pipeT -= dt;
    if (this.p > 0.15 && this.p < 0.9 && this.pipeT <= 0) {
      this.pipeT = 2.6;
      const gapH = lerp(11, 7, this.p);
      const gapY = 3 + Math.random() * (GROUND_Y - 3 - gapH - 2);
      this.pipes.push({ x: COLS + 0.5, gapY, gapH, passed: false });
      if (this.pipes.length === 1) this.ctx.fx.burst(this.ax, AI_Y, PALETTES.flapper.wall, 20, 6);
    }
    const speed = lerp(1, 4, this.p);
    for (const pp of this.pipes) {
      pp.x -= speed * dt;
      if (!pp.passed && pp.x + PIPE_W < this.ball.x) {
        pp.passed = true;
        this.passed++;
        this.ctx.addScore(50);
        this.advance(1 / 12);
      }
      // mild: pipes push the ball instead of killing it
      const b = this.ball;
      if (b.x + BALL_R > pp.x && b.x - BALL_R < pp.x + PIPE_W && (b.y < pp.gapY || b.y > pp.gapY + pp.gapH)) {
        b.x = pp.x - BALL_R;
        b.vx = -Math.abs(b.vx) - 1;
      }
    }
    this.pipes = this.pipes.filter((pp) => pp.x > -PIPE_W - 1);
  }

  next(): Mode {
    return new Flapper(this.ctx, { y: this.ball.y, vy: this.ball.vy, x: this.ball.x, pipes: this.pipes });
  }

  render(r: Renderer) {
    const P = r.pal;
    const m = this.morphing ? this.p : 0;
    for (let y = 0; y < 24; y++) {
      r.alpha(1 - m);
      r.block(0, y, P.wall2);
      r.block(COLS - 1, y, P.wall2);
    }
    r.alpha(1 - m);
    for (let x = 1; x < COLS - 1; x += 2) r.rect(x * CELL + 2, 12 * CELL, 4, 1, P.wall2);
    r.alpha(1);

    // pipes (morph)
    for (const pp of this.pipes) drawPipe(r, pp);

    // ground rising in
    if (m > 0) {
      r.alpha(clamp01(m * 1.5));
      r.rect(0, GROUND_Y * CELL, COLS * CELL, (24 - GROUND_Y) * CELL, PALETTES.flapper.enemy);
      r.rect(0, GROUND_Y * CELL, COLS * CELL, 2, PALETTES.flapper.wall);
      r.alpha(1);
    }

    const ahw = this.aw() / 2;
    if (ahw > 0) r.rect((this.ax - ahw) * CELL, AI_Y * CELL, ahw * 2 * CELL, PH * CELL, P.enemy);
    const hw = this.pw() / 2;
    r.rect((this.px - hw) * CELL, PADDLE_Y * CELL, hw * 2 * CELL, PH * CELL, P.player);

    if (this.dead) return;
    const b = this.ball;
    if (this.serveT > 0 && Math.floor(this.t * 8) % 2) return;
    if (m > 0.5) {
      const s = this.flapT > 0 ? SPR.bird2 : SPR.bird1;
      r.sprite(s, b.x * CELL - 4, b.y * CELL - 4, { X: mix(P.food, PALETTES.flapper.player, (m - 0.5) * 2), o: PALETTES.flapper.player2, w: '#ffffff' });
    } else r.rect(b.x * CELL - 2, b.y * CELL - 2, 4, 4, P.food);
  }
}

export function drawPipe(r: Renderer, pp: Pipe, alpha = 1) {
  const P = r.pal;
  const x = pp.x * CELL;
  const w = PIPE_W * CELL;
  const top = pp.gapY * CELL;
  const bot = (pp.gapY + pp.gapH) * CELL;
  r.alpha(alpha);
  r.rect(x, 0, w, top, P.wall);
  r.rect(x + w - 3, 0, 2, top, P.wall2);
  r.rect(x - 1, top - 4, w + 2, 4, P.wall2);
  r.rect(x, bot, w, GROUND_Y * CELL - bot, P.wall);
  r.rect(x + w - 3, bot, 2, GROUND_Y * CELL - bot, P.wall2);
  r.rect(x - 1, bot, w + 2, 4, P.wall2);
  r.alpha(1);
}

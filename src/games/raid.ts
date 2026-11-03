import { type Cell, CELL, clamp, clamp01, COLS, easeInOut, idx, lerp, rnd } from '../core/constants';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import { mix, PALETTES } from '../core/palette';
import type { Renderer } from '../core/render';
import { SPR } from '../core/sprites';
import { FORM, SHIP_ROW, slotX, slotY } from './layout';
import { Paddle, AI_Y, PADDLE_Y } from './paddle';

export interface RaidInit {
  slots: { i: number; j: number }[];
  shields: Cell[];
  playerX: number;
}

interface Invader {
  i: number;
  j: number;
  alive: boolean;
}
interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Seg {
  fx: number;
  fy: number;
  k: number;
  slot: number;
}

const MIN_X = 1.5;
const MAX_X = COLS - 1.5;
const SEG_SLOTS = 5;

/**
 * ALIEN RAID. Milestone: shoot all but the last 5 invaders.
 * Morph → PADDLE: your shots start bouncing off walls (aim by moving), the
 * remaining invaders fly up and weld into the opponent's paddle, and your
 * ship flattens into a paddle that bounces shots back.
 */
export class Raid extends Mode {
  readonly id = 'raid' as const;
  inv: Invader[];
  total: number;
  kills = 0;
  target: number;
  ox = 0;
  oy = 0;
  dirX = 1;
  stepT = 0;
  frame = 0;
  x: number;
  vx = 0;
  shot: Bullet | null = null;
  enemyShots: Bullet[] = [];
  fireT = 1.5;
  shields = new Map<number, number>();
  dead = false;

  // morph
  remainAtStart = 1;
  converted = 0;
  autoT = 0;
  segs: Seg[] = [];

  constructor(ctx: Ctx, init: RaidInit) {
    super(ctx);
    let slots = init.slots;
    if (slots.length < 10) {
      slots = [];
      for (let j = 0; j < FORM.rows; j++) for (let i = 0; i < FORM.cols; i++) slots.push({ i, j });
    }
    this.inv = slots.map((s) => ({ ...s, alive: true }));
    this.total = this.inv.length;
    this.target = Math.max(1, this.total - 5);
    for (const s of init.shields) this.shields.set(idx(s.c, s.r), 3);
    this.x = clamp(init.playerX, MIN_X, MAX_X);
    this.invuln = 1;
  }

  milestone(): Milestone {
    if (this.morphing) return { cur: this.converted, target: this.remainAtStart, label: 'paddle' };
    return { cur: this.kills, target: this.target, label: 'invaders' };
  }

  hint() {
    return this.morphing ? '← → / drag · shots bounce off your ship' : '← → / drag · SPACE / tap shoot';
  }
  morphHint() {
    return 'Shots bounce now. Hit them back!';
  }

  invPos(v: Invader) {
    return { x: slotX(v.i) + this.ox, y: slotY(v.j) + this.oy };
  }

  update(dt: number) {
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dead) return;
    const input = this.ctx.input;
    const sp = Math.min(this.ctx.speed, 1.6);

    // ship
    let ax = input.axisX();
    if (input.pointerX !== null) {
      const d = input.pointerX - this.x;
      ax = Math.abs(d) < 0.15 ? 0 : clamp(d * 2, -1, 1);
    }
    this.vx = ax * 8;
    this.x = clamp(this.x + this.vx * dt, MIN_X, MAX_X);
    const fire = input.wasPressed('action') || input.wasPressed('up') || (input.touching && input.lastSource === 'touch');
    if (fire && !this.shot) {
      this.shot = { x: this.x, y: SHIP_ROW - 0.2, vx: this.morphing ? this.vx * 0.5 : 0, vy: -18 };
      this.ctx.sfx.shoot();
    }

    this.updateFormation(dt, sp);
    this.updateShot(dt);
    this.updateEnemyShots(dt, sp);
    if (this.morphing) this.updateMorph(dt);
  }

  private alive() {
    return this.inv.filter((v) => v.alive);
  }

  private updateFormation(dt: number, sp: number) {
    const alive = this.alive();
    if (!alive.length) return;
    this.stepT -= dt;
    if (this.stepT > 0) return;
    this.stepT = (0.05 + (0.55 * alive.length) / this.total) / sp;
    this.frame ^= 1;
    const nx = this.ox + 0.25 * this.dirX;
    const xs = alive.map((v) => slotX(v.i) + nx);
    if (Math.min(...xs) < 1 || Math.max(...xs) + 1 > COLS - 1) {
      this.dirX *= -1;
      if (!this.morphing) this.oy += 0.5;
    } else this.ox = nx;
    // reaching the shields / the ground
    for (const v of alive) {
      const p = this.invPos(v);
      for (let c = Math.floor(p.x); c <= Math.floor(p.x + 0.99); c++) this.shields.delete(idx(c, Math.floor(p.y + 0.99)));
      if (p.y + 1 >= SHIP_ROW && this.invuln <= 0) {
        this.ctx.toast('Invasion!');
        return this.die();
      }
    }
  }

  private hitShield(b: Bullet): boolean {
    const i = idx(Math.floor(b.x), Math.floor(b.y));
    const hp = this.shields.get(i);
    if (hp === undefined) return false;
    if (hp <= 1) this.shields.delete(i);
    else this.shields.set(i, hp - 1);
    this.ctx.fx.burst(b.x, b.y, PALETTES.raid.wall, 4, 3);
    return true;
  }

  private updateShot(dt: number) {
    const s = this.shot;
    if (!s) return;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (this.morphing) {
      if (s.x < 1) {
        s.x = 1;
        s.vx = Math.abs(s.vx);
        this.ctx.sfx.wall();
      } else if (s.x > COLS - 1) {
        s.x = COLS - 1;
        s.vx = -Math.abs(s.vx);
        this.ctx.sfx.wall();
      }
    }
    if (this.hitShield(s)) {
      this.shot = null;
      return;
    }
    for (const v of this.inv) {
      if (!v.alive) continue;
      const p = this.invPos(v);
      if (s.x > p.x + 0.05 && s.x < p.x + 0.95 && s.y > p.y && s.y < p.y + 1) {
        v.alive = false;
        this.shot = null;
        this.kills++;
        this.ctx.addScore([40, 20, 20, 10][v.j] ?? 10);
        this.ctx.sfx.pop();
        this.ctx.fx.burst(p.x + 0.5, p.y + 0.5, PALETTES.raid.enemy, 12, 6);
        if (this.morphing) this.convert(p.x, p.y);
        return;
      }
    }
    if (this.morphing) {
      // Top: bounce off the welded paddle; bottom: bounce off the ship.
      const segW = this.segs.filter((g) => g.k >= 1).length;
      if (s.vy < 0 && s.y < AI_Y + 0.5 && segW > 0 && Math.abs(s.x - COLS / 2) < segW / 2 + 0.3) {
        s.vy = Math.abs(s.vy) * 0.6;
        this.ctx.sfx.hit();
      } else if (s.vy > 0 && s.y > PADDLE_Y && s.y < PADDLE_Y + 0.8 && Math.abs(s.x - this.x) < this.shipW() / 2 + 0.3) {
        s.vy = -14;
        s.vx = (s.x - this.x) * 7;
        this.ctx.sfx.hit();
      }
    }
    if (s.y < 0.5 || s.y > SHIP_ROW + 1.5) this.shot = null;
  }

  shipW() {
    return this.morphing ? lerp(1, 3, clamp01(this.p * 1.4)) : 1;
  }

  private updateEnemyShots(dt: number, sp: number) {
    this.fireT -= dt;
    const alive = this.alive();
    if (this.fireT <= 0 && alive.length) {
      this.fireT = (lerp(0.45, 1.3, alive.length / this.total) / sp) * (this.morphing ? 2.2 : 1);
      // bottom invader of a random column
      const cols = [...new Set(alive.map((v) => v.i))];
      const col = cols[rnd(cols.length)];
      const shooter = alive.filter((v) => v.i === col).sort((a, b) => b.j - a.j)[0];
      const p = this.invPos(shooter);
      this.enemyShots.push({ x: p.x + 0.5, y: p.y + 1, vx: 0, vy: 7 * sp });
    }
    for (const b of this.enemyShots) {
      b.y += b.vy * dt;
      if (this.hitShield(b)) b.y = 99;
      else if (b.y > SHIP_ROW + 0.2 && b.y < SHIP_ROW + 1 && Math.abs(b.x - this.x) < this.shipW() / 2 + 0.2 && this.invuln <= 0) {
        b.y = 99;
        this.die();
        return;
      }
    }
    this.enemyShots = this.enemyShots.filter((b) => b.y < SHIP_ROW + 1.5);
  }

  private die() {
    this.dead = true;
    this.ctx.sfx.die();
    this.ctx.fx.burst(this.x, SHIP_ROW + 0.5, PALETTES.raid.player, 24, 7);
    this.ctx.fx.doShake(4);
    this.ctx.loseLife();
  }

  respawn() {
    this.dead = false;
    this.invuln = 2;
    this.enemyShots = [];
    this.shot = null;
    this.x = COLS / 2;
    this.oy = Math.max(0, this.oy - 2);
    this.fireT = 1.5;
  }

  // ---------------------------------------------------------------- morph
  protected override onMorphStart() {
    this.remainAtStart = Math.max(1, this.alive().length);
  }

  private convert(x: number, y: number) {
    this.converted++;
    this.segs.push({ fx: x, fy: y, k: 0, slot: this.segs.length });
    this.ctx.addScore(20);
  }

  private updateMorph(dt: number) {
    this.autoT += dt;
    if (this.autoT > Math.min(4.5, 24 / this.remainAtStart)) {
      this.autoT = 0;
      const a = this.alive();
      if (a.length) {
        const v = a[rnd(a.length)];
        v.alive = false;
        const p = this.invPos(v);
        this.convert(p.x, p.y);
      }
    }
    for (const g of this.segs) g.k = Math.min(1, g.k + dt * 1.4);
    this.p = Math.min(1, this.converted / this.remainAtStart);
  }

  private segPos(g: Seg) {
    const n = Math.min(SEG_SLOTS, Math.max(this.remainAtStart, 1));
    const tx = COLS / 2 - n / 2 + (g.slot % n);
    const e = easeInOut(g.k);
    return { x: lerp(g.fx, tx, e), y: lerp(g.fy, AI_Y, e) };
  }

  override ready() {
    return this.morphing && this.p >= 1 && this.segs.every((g) => g.k >= 1) && !this.dead;
  }

  next(): Mode {
    const ball = this.shot && this.shot.vy !== 0 ? { x: this.shot.x, y: this.shot.y, vx: this.shot.vx, vy: this.shot.vy > 0 ? 9 : -9 } : null;
    return new Paddle(this.ctx, { playerX: this.x, ball });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (let y = 0; y < 24; y++) {
      r.block(0, y, P.wall2);
      r.block(COLS - 1, y, P.wall2);
    }
    r.rect(8, (SHIP_ROW + 1) * CELL, (COLS - 2) * CELL, 1, P.wall);

    for (const [i, hp] of this.shields) {
      r.alpha(0.35 + hp * 0.22);
      r.cell(i % COLS, Math.floor(i / COLS), P.wall);
      r.alpha(1);
    }

    for (const v of this.inv) {
      if (!v.alive) continue;
      const p = this.invPos(v);
      const s = v.j < 2 ? (this.frame ? SPR.alienB1 : SPR.alienB2) : this.frame ? SPR.alienA1 : SPR.alienA2;
      r.spriteAt(s, p.x, p.y, { X: v.j < 2 ? P.enemy2 : P.enemy, o: P.bg });
    }

    for (const g of this.segs) {
      const p = this.segPos(g);
      r.block(p.x, p.y, mix(PALETTES.raid.enemy, PALETTES.paddle.enemy, g.k));
    }

    for (const b of this.enemyShots) {
      const zig = Math.floor(this.t * 12) % 2;
      r.rect(b.x * CELL - 1 + zig, b.y * CELL - 3, 1, 2, P.accent);
      r.rect(b.x * CELL - zig, b.y * CELL - 1, 1, 2, P.accent);
    }
    if (this.shot) {
      if (this.morphing && this.p > 0.4) r.disc(this.shot.x * CELL, this.shot.y * CELL, 2, P.food);
      else r.rect(this.shot.x * CELL - 0.5, this.shot.y * CELL - 2, 1, 4, P.food);
    }

    if (this.dead && Math.floor(this.t * 10) % 2) return;
    if (this.invuln > 0 && Math.floor(this.t * 12) % 2) return;
    if (this.morphing && this.p > 0.3) {
      const w = this.shipW();
      r.rect((this.x - w / 2) * CELL, PADDLE_Y * CELL, w * CELL, 4, P.player);
    } else r.sprite(SPR.ship, (this.x - 0.5) * CELL, SHIP_ROW * CELL, { X: P.player, o: P.player2 });
  }
}

import { CELL, DV, DIRS } from '../core/constants';
import type { Ctx } from '../core/mode';
import type { Renderer } from '../core/render';
import { SPR } from '../core/sprites';

export interface Bomb {
  c: number;
  r: number;
  t: number;
  range: number;
}
interface Flame {
  c: number;
  r: number;
  t: number;
}

/** What a flame ray does when it reaches a tile. */
export type RayHit = 'stop' | 'brick' | 'pass';

export interface BombWorld {
  ray(c: number, r: number): RayHit;
  onBrick(c: number, r: number): void;
}

export const FUSE = 2.2;
const FLAME_T = 0.5;

/** Bomb + flame system, shared by CHOMPER (during its morph) and BOMBER. */
export class Bombs {
  bombs: Bomb[] = [];
  flames: Flame[] = [];
  constructor(
    private ctx: Ctx,
    public world: BombWorld,
  ) {}

  has(c: number, r: number) {
    return this.bombs.some((b) => b.c === c && b.r === r);
  }

  place(c: number, r: number, range: number, max: number) {
    if (this.bombs.length >= max || this.has(c, r)) return false;
    this.bombs.push({ c, r, t: FUSE, range });
    this.ctx.sfx.wall();
    return true;
  }

  flameAt(c: number, r: number) {
    return this.flames.some((f) => f.c === c && f.r === r);
  }

  clear() {
    this.bombs = [];
    this.flames = [];
  }

  update(dt: number) {
    for (const f of this.flames) f.t -= dt;
    this.flames = this.flames.filter((f) => f.t > 0);
    for (const b of this.bombs) b.t -= dt;
    let guard = 0;
    while (guard++ < 50) {
      const b = this.bombs.find((x) => x.t <= 0);
      if (!b) break;
      this.explode(b);
    }
  }

  private explode(b: Bomb) {
    this.bombs.splice(this.bombs.indexOf(b), 1);
    this.addFlame(b.c, b.r);
    for (const d of DIRS) {
      const [dx, dy] = DV[d];
      for (let k = 1; k <= b.range; k++) {
        const c = b.c + dx * k;
        const r = b.r + dy * k;
        const hit = this.world.ray(c, r);
        if (hit === 'stop') break;
        this.addFlame(c, r);
        const other = this.bombs.find((x) => x.c === c && x.r === r);
        if (other) other.t = Math.min(other.t, 0.06);
        if (hit === 'brick') {
          this.world.onBrick(c, r);
          break;
        }
      }
    }
    this.ctx.sfx.explode();
    this.ctx.fx.doShake(3);
    this.ctx.fx.burst(b.c + 0.5, b.r + 0.5, '#ffd23f', 14, 7);
  }

  private addFlame(c: number, r: number) {
    this.flames.push({ c, r, t: FLAME_T });
  }

  render(r: Renderer, time: number) {
    const P = r.pal;
    for (const b of this.bombs) {
      const pulse = b.t < 0.7 ? Math.floor(time * 16) % 2 : Math.floor(time * 5) % 2;
      r.spriteAt(SPR.bomb, b.c, b.r, { X: pulse ? '#3a3a4a' : '#1a1a24', o: P.accent, w: '#ffffff' });
    }
    for (const f of this.flames) {
      const k = f.t / FLAME_T;
      r.cell(f.c, f.r, P.accent, k > 0.5 ? 0 : 1);
      r.rect(f.c * CELL + 2, f.r * CELL + 2, 4, 4, '#ffe9a0');
    }
  }
}

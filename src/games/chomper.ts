import { type Cell, COLS, type Dir, DV, idx, isBorder, OPP, pick, ROWS, T } from '../core/constants';
import { advance, aligned, CHOMPER_START, coveredTiles, HOUSE_EXIT, HOUSE_IN, type Mover, openDirs, parseMaze, reverse, tileAt } from '../core/grid';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import type { Renderer } from '../core/render';
import { rotate, SPR } from '../core/sprites';
import { Bomber } from './bomber';
import { Bombs } from './bombs';
import { drawTile } from './tiles';

export interface ChomperInit {
  tiles: Uint8Array;
  dots: Uint8Array;
  start: Cell;
  dir: Dir;
}

type GState = 'house' | 'leaving' | 'active' | 'eyes' | 'gone';
interface Ghost extends Mover {
  n: number;
  state: GState;
  release: number;
  color: string;
  face: Dir;
  scared: boolean;
}

const GHOST_COLORS = ['#ff5d5d', '#ff8de0', '#4ae8ff', '#ffa94a'];
const HOUSE_SPOTS: Cell[] = [
  { c: 7, r: 9 },
  { c: 6, r: 9 },
  { c: 8, r: 9 },
  { c: 7, r: 9 },
];
const CORNERS: Cell[] = [
  { c: 13, r: 1 },
  { c: 1, r: 1 },
  { c: 13, r: 22 },
  { c: 1, r: 22 },
];
const ROT: Record<Dir, number> = { right: 0, down: 1, left: 2, up: 3 };
const SOLID_FOR_WALKERS = new Set<number>([T.BORDER, T.WALL, T.DOOR, T.HOUSE, T.BRICK, T.PILLAR]);

/**
 * CHOMPER (maze chase). Milestone: eat N ghosts (use power pellets).
 * Morph → BOMBER: SPACE starts dropping bombs, maze walls turn into bricks and
 * pillars, bombed ghosts pop. Ghosts are slower while the arena rebuilds.
 */
export class Chomper extends Mode {
  readonly id = 'chomper' as const;
  tiles: Uint8Array;
  dots: Uint8Array;
  pl: Mover & { face: Dir; want: Dir | null; anim: number };
  ghosts: Ghost[] = [];
  fright = 0;
  chain = 0;
  chaseClock = 0;
  eaten = 0;
  target: number;
  dead = false;
  powerTimer = 0;
  powerSpots: number[];

  // morph
  arena = new Uint8Array(COLS * ROWS);
  changeAt = new Float32Array(COLS * ROWS);
  converted = new Uint8Array(COLS * ROWS);
  pending = 0;
  bombs: Bombs;

  constructor(ctx: Ctx, init: ChomperInit) {
    super(ctx);
    this.tiles = init.tiles;
    this.dots = init.dots;
    const s = tileAt(this.tiles, init.start.c, init.start.r) === T.HOUSE ? CHOMPER_START : init.start;
    this.pl = { x: s.c, y: s.r, dir: null, face: init.dir, want: init.dir, anim: 0 };
    const md = parseMaze().dots;
    this.powerSpots = [];
    md.forEach((d, i) => d === 2 && this.powerSpots.push(i));
    this.target = 2 + Math.floor((ctx.round - 1) / 2);
    this.resetGhosts();
    this.bombs = new Bombs(ctx, {
      ray: (c, r) => {
        const t = tileAt(this.tiles, c, r);
        if (t === T.BORDER || t === T.PILLAR) return 'stop';
        if (t === T.WALL || t === T.DOOR || t === T.HOUSE || t === T.BRICK) return 'brick';
        return 'pass';
      },
      onBrick: (c, r) => {
        const i = idx(c, r);
        this.tiles[i] = T.EMPTY;
        if (!this.converted[i]) {
          this.converted[i] = 1;
          this.pending--;
        }
        this.arena[i] = T.EMPTY;
        this.ctx.addScore(10);
        this.advance(0.015);
        this.ctx.fx.burst(c + 0.5, r + 0.5, '#c0703f', 6, 5);
      },
    });
  }

  private resetGhosts() {
    const sp = this.ctx.speed;
    this.ghosts = HOUSE_SPOTS.map((h, n) => ({
      n,
      x: h.c,
      y: h.r,
      dir: null,
      face: 'up',
      state: 'house',
      release: (1.5 + n * 2.5) / sp,
      color: GHOST_COLORS[n],
      scared: false,
    }));
  }

  milestone(): Milestone {
    if (this.morphing) return { cur: Math.round(this.p * 100), target: 100, label: 'prestavba' };
    return { cur: this.eaten, target: this.target, label: 'duchovia' };
  }

  hint() {
    return this.morphing ? '← ↑ → ↓ pohyb · SPACE / tap bomba' : '← ↑ → ↓ / swipe · power pellet → zjedz duchov';
  }
  morphHint() {
    return 'SPACE / tap = bomba!';
  }

  private walkable = (c: number, r: number) => {
    if (SOLID_FOR_WALKERS.has(tileAt(this.tiles, c, r))) return false;
    if (this.morphing && this.bombs.has(c, r)) {
      // You can always walk off a bomb you are standing on.
      return coveredTiles(this.pl).some(([x, y]) => x === c && y === r);
    }
    return true;
  };

  private ghostWalkable(g: Ghost) {
    return (c: number, r: number) => {
      const t = tileAt(this.tiles, c, r);
      if (g.state === 'leaving' || g.state === 'eyes') return t !== T.BORDER && t !== T.WALL && t !== T.BRICK && t !== T.PILLAR;
      if (SOLID_FOR_WALKERS.has(t)) return false;
      return !(this.morphing && this.bombs.has(c, r));
    };
  }

  update(dt: number) {
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dead) return;
    const sp = Math.min(this.ctx.speed, 1.5);
    const input = this.ctx.input;

    let d: Dir | undefined;
    while ((d = input.takeDir())) this.pl.want = d;
    if (this.pl.want && this.pl.dir && this.pl.want === OPP[this.pl.dir]) reverse(this.pl);

    const before = this.pl.x + this.pl.y;
    advance(
      this.pl,
      5 * sp * dt,
      (c, r) => {
        const w = this.pl.want;
        if (w && this.walkable(c + DV[w][0], r + DV[w][1])) return w;
        return this.pl.dir;
      },
      this.walkable,
    );
    if (this.pl.dir) this.pl.face = this.pl.dir;
    this.pl.anim += Math.abs(this.pl.x + this.pl.y - before);

    this.eatDots();

    if (this.fright > 0) {
      this.fright -= dt;
      if (this.fright <= 0) for (const g of this.ghosts) g.scared = false;
    }
    this.chaseClock += dt;
    this.updateGhosts(dt, sp);

    if (!this.morphing) this.respawnPower(dt);
    else this.updateMorph(dt);
  }

  private eatDots() {
    const c = Math.round(this.pl.x);
    const r = Math.round(this.pl.y);
    const i = idx(c, r);
    const d = this.dots[i];
    if (!d) return;
    this.dots[i] = 0;
    if (d === 1) {
      this.ctx.addScore(10);
      this.ctx.sfx.dot();
    } else {
      this.ctx.addScore(50);
      this.ctx.sfx.power();
      this.fright = Math.max(2.5, 6.5 / this.ctx.speed);
      this.chain = 0;
      for (const g of this.ghosts)
        if (g.state === 'active') {
          g.scared = true;
          reverse(g);
        }
    }
    if (!this.morphing && !this.dots.some((x) => x)) {
      this.ctx.addScore(500);
      this.ctx.sfx.bonus();
      this.ctx.toast('Bludisko čisté! +500');
      const md = parseMaze().dots;
      md.forEach((v, k) => {
        if (this.tiles[k] === T.EMPTY) this.dots[k] = v;
      });
    }
  }

  private respawnPower(dt: number) {
    if (this.powerSpots.some((i) => this.dots[i] === 2) || this.fright > 0) {
      this.powerTimer = 0;
      return;
    }
    this.powerTimer += dt;
    if (this.powerTimer > 8) {
      this.powerTimer = 0;
      for (const i of this.powerSpots) if (this.tiles[i] === T.EMPTY) this.dots[i] = 2;
    }
  }

  private ghostTarget(g: Ghost): Cell {
    if (g.state === 'eyes') return HOUSE_IN;
    const pc = { c: Math.round(this.pl.x), r: Math.round(this.pl.y) };
    const scatter = this.chaseClock % 24 < 6;
    if (scatter) return CORNERS[g.n];
    const [fx, fy] = DV[this.pl.face];
    switch (g.n) {
      case 0:
        return pc;
      case 1:
        return { c: pc.c + fx * 3, r: pc.r + fy * 3 };
      case 2: {
        const dist = Math.abs(g.x - pc.c) + Math.abs(g.y - pc.r);
        return dist > 6 ? pc : CORNERS[2];
      }
      default: {
        const g0 = this.ghosts[0];
        return { c: 2 * pc.c - Math.round(g0.x), r: 2 * pc.r - Math.round(g0.y) };
      }
    }
  }

  private updateGhosts(dt: number, sp: number) {
    const morphSlow = this.morphing ? 0.75 : 1;
    for (const g of this.ghosts) {
      if (g.state === 'gone') continue;
      if (g.state === 'house') {
        g.release -= dt;
        if (g.release <= 0) g.state = 'leaving';
        continue;
      }
      const walk = this.ghostWalkable(g);
      let speed = Math.min(5.2, 4.4 * sp) * morphSlow;
      if (g.scared) speed = 2.6;
      if (g.state === 'eyes') speed = 9;
      if (g.state === 'leaving') speed = 3;
      advance(
        g,
        speed * dt,
        (c, r) => {
          if (g.state === 'leaving') {
            if (c === HOUSE_EXIT.c && r === HOUSE_EXIT.r) {
              g.state = 'active';
              g.scared = false;
            } else if (r === HOUSE_IN.r && c !== HOUSE_IN.c) return c < HOUSE_IN.c ? 'right' : 'left';
            else return 'up';
          }
          if (g.state === 'eyes' && c === HOUSE_IN.c && r === HOUSE_IN.r) {
            g.state = 'leaving';
            return 'up';
          }
          const w = this.ghostWalkable(g);
          let opts = openDirs(c, r, w).filter((d) => !g.dir || d !== OPP[g.dir]);
          if (!opts.length) opts = openDirs(c, r, w);
          if (!opts.length) return null;
          if (g.scared) return pick(opts);
          const tg = this.ghostTarget(g);
          let best = opts[0];
          let bd = Infinity;
          for (const d of opts) {
            const dd = (c + DV[d][0] - tg.c) ** 2 + (r + DV[d][1] - tg.r) ** 2;
            if (dd < bd) {
              bd = dd;
              best = d;
            }
          }
          return best;
        },
        walk,
      );
      if (g.dir) g.face = g.dir;
      // A ghost boxed in by new pillars just waits.
      if (!g.dir && aligned(g) && !openDirs(g.x, g.y, walk).length) continue;

      if (this.morphing && (g.state === 'active' || g.state === 'leaving') && this.bombs.flameAt(Math.round(g.x), Math.round(g.y))) {
        g.state = 'gone';
        this.ctx.addScore(200);
        this.ctx.sfx.pop();
        this.advance(0.12);
        this.ctx.fx.burst(g.x + 0.5, g.y + 0.5, g.color, 16, 7);
        continue;
      }

      const dx = g.x - this.pl.x;
      const dy = g.y - this.pl.y;
      if (dx * dx + dy * dy < 0.36 && (g.state === 'active' || g.state === 'leaving')) {
        if (g.scared) {
          const pts = 200 * 2 ** this.chain++;
          this.ctx.addScore(pts);
          this.ctx.sfx.bonus();
          this.ctx.fx.burst(g.x + 0.5, g.y + 0.5, g.color, 14, 6);
          g.scared = false;
          if (this.morphing) g.state = 'gone';
          else {
            g.state = 'eyes';
            this.eaten++;
          }
        } else if (this.invuln <= 0) {
          this.die();
          return;
        }
      }
    }
    if (this.morphing && this.bombs.flameAt(Math.round(this.pl.x), Math.round(this.pl.y)) && this.invuln <= 0) this.die();
  }

  private die() {
    this.dead = true;
    this.ctx.sfx.die();
    this.ctx.fx.burst(this.pl.x + 0.5, this.pl.y + 0.5, '#b6ff4a', 24, 7);
    this.ctx.fx.doShake(4);
    this.ctx.loseLife();
  }

  respawn() {
    this.dead = false;
    this.invuln = 1.5;
    this.fright = 0;
    this.ctx.input.clearBuffers();
    const s = this.freeTileNear(CHOMPER_START);
    this.pl.x = s.c;
    this.pl.y = s.r;
    this.pl.dir = null;
    this.pl.want = 'left';
    this.bombs.clear();
    const alive = this.ghosts.filter((g) => g.state !== 'gone').map((g) => g.n);
    this.resetGhosts();
    for (const g of this.ghosts) if (!alive.includes(g.n)) g.state = 'gone';
    if (this.morphing) this.releaseFromHouse();
  }

  private freeTileNear(s: Cell): Cell {
    let best = s;
    let bd = Infinity;
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++) {
        if (!this.walkable(c, r) || !openDirs(c, r, this.walkable).length) continue;
        const d = Math.abs(c - s.c) + Math.abs(r - s.r);
        if (d < bd) {
          bd = d;
          best = { c, r };
        }
      }
    return best;
  }

  private releaseFromHouse() {
    this.ghosts.forEach((g, k) => {
      if (g.state === 'house') g.release = 0.5 + k * 0.8;
    });
  }

  protected override onMorphStart() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        let t: number = T.EMPTY;
        if (isBorder(c, r)) t = T.BORDER;
        else if (c % 2 === 0 && r % 2 === 0 && r <= 20) t = T.PILLAR;
        else if (this.tiles[i] === T.WALL || this.tiles[i] === T.DOOR || this.tiles[i] === T.HOUSE) t = Math.random() < 0.8 ? T.BRICK : T.EMPTY;
        this.arena[i] = t;
        if (t === this.tiles[i]) this.converted[i] = 1;
        else {
          this.pending++;
          this.changeAt[i] = 0.05 + Math.random() * 0.85;
        }
      }
    this.releaseFromHouse();
  }

  private occupied(c: number, r: number) {
    const hit = (m: Mover) => coveredTiles(m).some(([x, y]) => x === c && y === r);
    if (hit(this.pl)) return true;
    if (this.bombs.has(c, r)) return true;
    return this.ghosts.some((g) => g.state !== 'gone' && hit(g));
  }

  private updateMorph(dt: number) {
    this.advance(dt / 35);
    this.bombs.update(dt);
    if (this.ctx.input.wasPressed('action')) {
      this.bombs.place(Math.round(this.pl.x), Math.round(this.pl.y), 2, 2);
    }
    const houseBusy = this.ghosts.some((g) => g.state === 'house' || g.state === 'leaving' || g.state === 'eyes');
    const force = this.p >= 1;
    for (let i = 0; i < this.arena.length; i++) {
      if (this.converted[i] || (this.changeAt[i] > this.p && !force)) continue;
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const cur = this.tiles[i];
      if (houseBusy && (cur === T.DOOR || cur === T.HOUSE) && !force) continue;
      let next = this.arena[i];
      if ((next === T.PILLAR || next === T.BRICK) && this.occupied(c, r)) {
        if (!force) continue;
        next = T.EMPTY;
      }
      this.tiles[i] = next;
      this.converted[i] = 1;
      this.pending--;
      if (next !== T.EMPTY) this.dots[i] = 0;
      this.ctx.fx.burst(c + 0.5, r + 0.5, next === T.PILLAR ? '#9aa7b4' : '#c0703f', 2, 2);
    }
  }

  override ready() {
    return this.morphing && this.p >= 1 && this.pending <= 0 && !this.dead;
  }

  next(): Mode {
    const enemies = this.ghosts.filter((g) => g.state === 'active' || g.state === 'leaving').map((g) => ({ c: Math.round(g.x), r: Math.round(g.y) }));
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] === T.DOOR || this.tiles[i] === T.HOUSE) this.tiles[i] = T.BRICK;
    return new Bomber(this.ctx, {
      tiles: this.tiles,
      player: { c: Math.round(this.pl.x), r: Math.round(this.pl.y) },
      enemies,
      bombs: this.bombs,
      face: this.pl.face,
    });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const t = this.tiles[idx(x, y)];
        if (t) drawTile(r, t, x, y);
        const d = this.dots[idx(x, y)];
        if (d === 1) r.dot(x, y, 2, P.food);
        else if (d === 2 && Math.floor(this.t * 4) % 2 === 0) r.dot(x, y, 4, P.food);
      }
    this.bombs.render(r, this.t);

    for (const g of this.ghosts) {
      if (g.state === 'gone') continue;
      const bob = g.state === 'house' ? Math.sin(this.t * 6 + g.n) * 1.2 : 0;
      const alt = Math.floor(this.t * 6) % 2;
      if (g.state === 'eyes') {
        r.sprite(SPR.eyes, g.x * 8, g.y * 8, { X: '#ffffff', o: '#2040ff', w: '#ffffff' });
      } else if (g.scared) {
        const flash = this.fright < 1.5 && Math.floor(this.t * 8) % 2;
        r.sprite(SPR.scared, g.x * 8, g.y * 8 + bob, { X: flash ? '#ffffff' : '#3b5bff', w: flash ? '#ff3b3b' : '#ffd6a5' });
      } else {
        const dv = DV[g.face];
        r.sprite(alt ? SPR.spook : SPR.spook2, g.x * 8, g.y * 8 + bob, { X: g.color, w: '#ffffff', o: '#1a1a40' });
        // pupils look where the ghost goes
        r.rect(g.x * 8 + 2 + Math.max(0, dv[0]), g.y * 8 + bob + 3 + Math.max(0, dv[1]), 1, 1, '#1a1a40');
        r.rect(g.x * 8 + 5 + Math.max(0, dv[0]), g.y * 8 + bob + 3 + Math.max(0, dv[1]), 1, 1, '#1a1a40');
      }
    }

    if (this.dead && Math.floor(this.t * 10) % 2) return;
    if (this.invuln > 0 && Math.floor(this.t * 12) % 2) return;
    const frames = [SPR.chompOpen, SPR.chompHalf, SPR.chompClosed, SPR.chompHalf];
    const f = frames[Math.floor(this.pl.anim * 3) % 4];
    r.sprite(rotate(f, ROT[this.pl.face]), this.pl.x * 8, this.pl.y * 8, { X: P.player });
  }
}


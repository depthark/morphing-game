import { type Cell, clamp01, COLS, type Dir, DV, easeInOut, idx, lerp, OPP, pick, ROWS, T } from '../core/constants';
import { advance, aligned, coveredTiles, type Mover, openDirs, reverse, tileAt } from '../core/grid';
import { Mode, type Ctx, type Milestone } from '../core/mode';
import { mix, PALETTES } from '../core/palette';
import type { Renderer } from '../core/render';
import { SPR } from '../core/sprites';
import type { Bombs } from './bombs';
import { FORM, SHIELD_CELLS, SHIP_ROW, slotX, slotY } from './layout';
import { Raid } from './raid';
import { BRICK_COLOR, drawBrick, drawTile } from './tiles';

export interface BomberInit {
  tiles: Uint8Array;
  player: Cell;
  enemies: Cell[];
  bombs: Bombs;
  face: Dir;
}

interface Enemy extends Mover {
  alive: boolean;
}
type ItemKind = 'flame' | 'bomb';

/** Something flying from the arena to its ALIEN RAID position during the morph. */
interface Flyer {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t0: number;
  kind: 'invader' | 'shield' | 'dust';
  from: 'brick' | 'pillar' | 'sky';
  slot?: { i: number; j: number };
  launched: boolean;
  dead: boolean;
}

const FLY_DUR = 0.32;

/**
 * BOMBER. Milestone: blow up every enemy.
 * Morph → ALIEN RAID: pillars and bricks lift off and line up as an invader
 * formation and shields; gravity drags the player down to the bottom row and
 * SPACE turns from bombs into upward shots.
 */
export class Bomber extends Mode {
  readonly id = 'bomber' as const;
  tiles: Uint8Array;
  pl: Mover & { face: Dir };
  enemies: Enemy[];
  items = new Map<number, ItemKind>();
  range = 2;
  maxBombs = 2;
  kills = 0;
  target: number;
  dead = false;
  bombs: Bombs;

  // morph
  flyers: Flyer[] = [];
  fallT = 0;
  fallReq = false;
  shot: { x: number; y: number } | null = null;

  constructor(ctx: Ctx, init: BomberInit) {
    super(ctx);
    this.tiles = init.tiles;
    this.pl = { x: init.player.c, y: init.player.r, dir: null, face: init.face };
    this.bombs = init.bombs;
    this.bombs.world = {
      ray: (c, r) => {
        const t = tileAt(this.tiles, c, r);
        if (t === T.BORDER || t === T.PILLAR || t === T.WALL) return 'stop';
        if (t === T.BRICK) return 'brick';
        return 'pass';
      },
      onBrick: (c, r) => this.breakBrick(c, r),
    };
    const want = 4 + Math.floor((ctx.round - 1) / 2);
    this.enemies = init.enemies.slice(0, want).map((e) => ({ x: e.c, y: e.r, dir: null, alive: true }));
    // Clear any tile under the enemies, then top up the count far from the player.
    for (const e of this.enemies) this.tiles[idx(e.x, e.y)] = T.EMPTY;
    const free: Cell[] = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++)
        if (this.tiles[idx(c, r)] === T.EMPTY && Math.abs(c - this.pl.x) + Math.abs(r - this.pl.y) >= 7) free.push({ c, r });
    while (this.enemies.length < want && free.length) {
      const k = Math.floor(Math.random() * free.length);
      const [c] = free.splice(k, 1);
      this.enemies.push({ x: c.c, y: c.r, dir: null, alive: true });
    }
    this.target = this.enemies.length;
    this.invuln = 1.5;
  }

  milestone(): Milestone {
    if (this.morphing) return { cur: Math.round(this.p * 100), target: 100, label: 'invasion' };
    return { cur: this.kills, target: this.target, label: 'enemies' };
  }

  hint() {
    if (this.morphing && this.p > 0.3) return '← → move · SPACE / tap shoot';
    return '← ↑ → ↓ hold / swipe · SPACE / tap bomb';
  }
  morphHint() {
    return 'Gravity is pulling you down!';
  }

  private walkable = (c: number, r: number) => {
    if (tileAt(this.tiles, c, r) !== T.EMPTY) return false;
    if (this.bombs.has(c, r)) return coveredTiles(this.pl).some(([x, y]) => x === c && y === r);
    return true;
  };
  private enemyWalkable = (c: number, r: number) => tileAt(this.tiles, c, r) === T.EMPTY && !this.bombs.has(c, r);

  private breakBrick(c: number, r: number) {
    const i = idx(c, r);
    this.tiles[i] = T.EMPTY;
    this.ctx.addScore(10);
    this.ctx.fx.burst(c + 0.5, r + 0.5, BRICK_COLOR, 8, 5);
    if (!this.morphing && Math.random() < 0.18) this.items.set(i, Math.random() < 0.5 ? 'flame' : 'bomb');
    if (this.morphing) {
      // A brick destroyed mid-flight no longer becomes an invader.
      const f = this.flyers.find((x) => !x.launched && x.from === 'brick' && x.fx === c && x.fy === r);
      if (f) f.dead = true;
    }
  }

  update(dt: number) {
    this.t += dt;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.dead) return;
    const input = this.ctx.input;
    const sp = Math.min(this.ctx.speed, 1.6);

    // --- player ---
    const held = input.heldDir();
    if (held && this.pl.dir && held === OPP[this.pl.dir] && !(this.morphing && held === 'up' && this.p > 0.25)) reverse(this.pl);
    advance(
      this.pl,
      4.2 * dt,
      (c, r) => {
        if (this.fallReq) {
          this.fallReq = false;
          if (this.walkable(c, r + 1)) return 'down';
        }
        const h = input.heldDir();
        if (!h) return null;
        if (this.morphing && h === 'up' && this.p > 0.25) return null;
        return this.walkable(c + DV[h][0], r + DV[h][1]) ? h : null;
      },
      this.walkable,
    );
    if (this.pl.dir) this.pl.face = this.pl.dir;
    input.dirQueue = [];

    const pc = Math.round(this.pl.x);
    const pr = Math.round(this.pl.y);
    const item = this.items.get(idx(pc, pr));
    if (item) {
      this.items.delete(idx(pc, pr));
      if (item === 'flame') this.range = Math.min(5, this.range + 1);
      else this.maxBombs = Math.min(4, this.maxBombs + 1);
      this.ctx.sfx.bonus();
      this.ctx.toast(item === 'flame' ? 'Range +1' : 'Bombs +1');
    }

    if (input.wasPressed('action')) {
      if (this.morphing && this.p > 0.3) this.fire();
      else this.bombs.place(pc, pr, this.range, this.maxBombs);
    }
    this.bombs.update(dt);

    // --- enemies ---
    for (const e of this.enemies) {
      if (!e.alive) continue;
      advance(
        e,
        2.2 * sp * dt,
        (c, r) => {
          let opts = openDirs(c, r, this.enemyWalkable).filter((d) => !e.dir || d !== OPP[e.dir]);
          if (!opts.length) opts = openDirs(c, r, this.enemyWalkable);
          if (!opts.length) return null;
          if (e.dir && opts.includes(e.dir) && Math.random() < 0.7) return e.dir;
          return pick(opts);
        },
        this.enemyWalkable,
      );
      if (this.bombs.flameAt(Math.round(e.x), Math.round(e.y))) {
        e.alive = false;
        this.kills++;
        this.ctx.addScore(100);
        this.ctx.sfx.pop();
        this.ctx.fx.burst(e.x + 0.5, e.y + 0.5, PALETTES.bomber.enemy, 16, 7);
        continue;
      }
      const dx = e.x - this.pl.x;
      const dy = e.y - this.pl.y;
      if (dx * dx + dy * dy < 0.5 && this.invuln <= 0) return this.die();
    }
    if (this.bombs.flameAt(pc, pr) && this.invuln <= 0) return this.die();

    if (this.morphing) this.updateMorph(dt);
  }

  private die() {
    this.dead = true;
    this.ctx.sfx.die();
    this.ctx.fx.burst(this.pl.x + 0.5, this.pl.y + 0.5, '#ffffff', 24, 7);
    this.ctx.fx.doShake(4);
    this.ctx.loseLife();
  }

  respawn() {
    this.dead = false;
    this.invuln = 2;
    this.bombs.clear();
    this.shot = null;
    this.ctx.input.clearBuffers();
    let best: Cell = { c: Math.round(this.pl.x), r: Math.round(this.pl.y) };
    let bd = -1;
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++) {
        if (!this.walkable(c, r) || !openDirs(c, r, this.walkable).length) continue;
        if (this.morphing && r < 12) continue;
        let near = 99;
        for (const e of this.enemies) if (e.alive) near = Math.min(near, Math.abs(e.x - c) + Math.abs(e.y - r));
        if (near > bd) {
          bd = near;
          best = { c, r };
        }
      }
    this.pl.x = best.c;
    this.pl.y = best.r;
    this.pl.dir = null;
  }

  // ---------------------------------------------------------------- morph
  protected override onMorphStart() {
    const bricks: Cell[] = [];
    const pillars: Cell[] = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++) {
        const t = this.tiles[idx(c, r)];
        if (t === T.BRICK) bricks.push({ c, r });
        else if (t === T.PILLAR || t === T.WALL) pillars.push({ c, r });
      }
    bricks.sort((a, b) => a.r - b.r || a.c - b.c);
    const slots: { i: number; j: number }[] = [];
    for (let j = 0; j < FORM.rows; j++) for (let i = 0; i < FORM.cols; i++) slots.push({ i, j });
    slots.forEach((s, k) => {
      const b = bricks[k];
      this.flyers.push({
        fx: b ? b.c : slotX(s.i),
        fy: b ? b.r : -2 - Math.random() * 3,
        tx: slotX(s.i),
        ty: slotY(s.j),
        t0: Math.random() * 0.55,
        kind: 'invader',
        from: b ? 'brick' : 'sky',
        slot: s,
        launched: false,
        dead: false,
      });
    });
    for (const b of bricks.slice(slots.length))
      this.flyers.push({ fx: b.c, fy: b.r, tx: b.c, ty: -3, t0: Math.random() * 0.55, kind: 'dust', from: 'brick', launched: false, dead: false });

    const free = [...pillars];
    for (const s of SHIELD_CELLS) {
      let k = -1;
      let bd = Infinity;
      free.forEach((p, n) => {
        const d = (p.c - s.c) ** 2 + (p.r - s.r) ** 2;
        if (d < bd) {
          bd = d;
          k = n;
        }
      });
      const p = k >= 0 ? free.splice(k, 1)[0] : { c: s.c, r: ROWS + 2 };
      this.flyers.push({ fx: p.c, fy: p.r, tx: s.c, ty: s.r, t0: Math.random() * 0.55, kind: 'shield', from: 'pillar', launched: false, dead: false });
    }
    for (const p of free)
      this.flyers.push({ fx: p.c, fy: p.r, tx: p.c, ty: p.r, t0: Math.random() * 0.55, kind: 'dust', from: 'pillar', launched: false, dead: false });
    this.items.clear();
  }

  private flyerPos(f: Flyer) {
    const k = clamp01((this.p - f.t0) / FLY_DUR);
    const e = easeInOut(k);
    return { x: lerp(f.fx, f.tx, e), y: lerp(f.fy, f.ty, e) - Math.sin(k * Math.PI) * 1.5, k };
  }

  private fire() {
    if (this.shot) return;
    this.shot = { x: this.pl.x + 0.5, y: this.pl.y };
    this.ctx.sfx.shoot();
  }

  private updateMorph(dt: number) {
    this.advance(dt / 20);
    for (const f of this.flyers) {
      if (f.launched || f.dead || this.p < f.t0) continue;
      f.launched = true;
      if (f.from !== 'sky') {
        this.tiles[idx(f.fx, f.fy)] = T.EMPTY;
        this.ctx.fx.burst(f.fx + 0.5, f.fy + 0.5, f.from === 'brick' ? BRICK_COLOR : '#9aa7b4', 3, 3);
      }
    }
    // gravity pulls the player toward the bottom row
    this.fallT += dt;
    const interval = lerp(1.1, 0.12, this.p);
    if (this.fallT >= interval) {
      // Consumed by the player's next tile decision (see update()).
      this.fallT = 0;
      this.fallReq = true;
    }

    if (this.shot) {
      this.shot.y -= 16 * dt;
      const c = Math.floor(this.shot.x);
      const r = Math.floor(this.shot.y);
      const t = tileAt(this.tiles, c, r);
      if (t === T.BRICK) {
        this.breakBrick(c, r);
        this.shot = null;
      } else if (t === T.BORDER || t === T.PILLAR || t === T.WALL) this.shot = null;
      else {
        for (const f of this.flyers) {
          if (f.kind !== 'invader' || f.dead || !f.launched) continue;
          const pos = this.flyerPos(f);
          if (pos.k < 1) continue;
          if (this.shot.x > pos.x && this.shot.x < pos.x + 1 && this.shot.y > pos.y && this.shot.y < pos.y + 1) {
            f.dead = true;
            this.shot = null;
            this.ctx.addScore(30);
            this.ctx.sfx.pop();
            this.ctx.fx.burst(pos.x + 0.5, pos.y + 0.5, PALETTES.raid.enemy, 12, 6);
            break;
          }
        }
      }
    }
  }

  override ready() {
    return this.morphing && this.p >= 1 && aligned(this.pl) && Math.round(this.pl.y) === SHIP_ROW && !this.dead;
  }

  next(): Mode {
    const slots = this.flyers.filter((f) => f.kind === 'invader' && !f.dead).map((f) => f.slot!);
    const shields = this.flyers.filter((f) => f.kind === 'shield').map((f) => ({ c: f.tx, r: f.ty }));
    return new Raid(this.ctx, { slots, shields, playerX: this.pl.x + 0.5 });
  }

  render(r: Renderer) {
    const P = r.pal;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const t = this.tiles[idx(x, y)];
        if (t) drawTile(r, t, x, y);
        else if ((x + y) % 2 === 0) r.cell(x, y, P.grid);
      }
    for (const [i, kind] of this.items) {
      const c = i % COLS;
      const y = Math.floor(i / COLS);
      if (this.tiles[i] !== T.EMPTY) continue;
      r.cell(c, y, P.wall2);
      r.spriteAt(kind === 'flame' ? SPR.flame : SPR.plusBomb, c, y, { X: P.accent, o: '#ffd23f', w: '#ffffff' });
    }
    this.bombs.render(r, this.t);

    for (const f of this.flyers) {
      if (!f.launched || f.dead) continue;
      const pos = this.flyerPos(f);
      if (f.kind === 'dust') {
        r.alpha(1 - pos.k);
        if (f.from === 'brick') drawBrick(r, pos.x, pos.y);
        else r.block(pos.x, pos.y, P.wall);
        r.alpha(1);
      } else if (f.kind === 'shield') {
        r.block(pos.x, pos.y, mix(PALETTES.bomber.wall, PALETTES.raid.wall, pos.k));
      } else if (pos.k < 0.5 && f.from === 'brick') drawBrick(r, pos.x, pos.y);
      else {
        const s = f.slot!.j < 2 ? (Math.floor(this.t * 3) % 2 ? SPR.alienB1 : SPR.alienB2) : Math.floor(this.t * 3) % 2 ? SPR.alienA1 : SPR.alienA2;
        r.spriteAt(s, pos.x, pos.y, { X: mix(BRICK_COLOR, PALETTES.raid.enemy, pos.k), o: PALETTES.raid.enemy2 });
      }
    }

    for (const e of this.enemies) {
      if (!e.alive) continue;
      r.spriteAt(SPR.balloon, e.x, e.y + Math.sin(this.t * 5 + e.x) * 0.06, { X: P.enemy, o: P.enemy2, w: '#ffffff' });
    }

    if (this.shot) r.rect(this.shot.x * 8 - 0.5, this.shot.y * 8, 1, 4, P.player);

    if (this.dead && Math.floor(this.t * 10) % 2) return;
    if (this.invuln > 0 && Math.floor(this.t * 12) % 2) return;
    if (this.morphing && this.p > 0.6) {
      r.spriteAt(SPR.ship, this.pl.x, this.pl.y, { X: mix(P.player, PALETTES.raid.player, (this.p - 0.6) / 0.4), o: P.player2 });
    } else {
      r.spriteAt(SPR.bomberman, this.pl.x, this.pl.y, { X: P.player, o: P.player2, w: '#101018' });
    }
  }
}

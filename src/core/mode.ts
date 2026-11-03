import { CELL, type GameId, nextOf, NAMES } from './constants';
import type { Audio } from './audio';
import type { Input } from './input';
import type { Renderer } from './render';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  g: number;
}

/** Particles, screen shake and flashes. Coordinates in board cells. */
export class Fx {
  parts: Particle[] = [];
  shake = 0;
  flash = 0;
  flashColor = '#ffffff';

  burst(c: number, r: number, color: string, n = 10, speed = 6, gravity = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.35 + Math.random() * 0.4;
      this.parts.push({ x: c, y: r, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: Math.random() < 0.3 ? 2 : 1, g: gravity });
    }
    if (this.parts.length > 600) this.parts.splice(0, this.parts.length - 600);
  }

  doShake(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  doFlash(color = '#ffffff', amount = 0.6) {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - dt * 10);
    this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  render(r: Renderer) {
    for (const p of this.parts) {
      r.alpha(p.life / p.max);
      r.rect(p.x * CELL - p.size / 2, p.y * CELL - p.size / 2, p.size, p.size, p.color);
    }
    r.alpha(1);
  }
}

export interface Ctx {
  round: number;
  /** Difficulty multiplier, grows every full loop. */
  speed: number;
  input: Input;
  sfx: Audio;
  fx: Fx;
  addScore(n: number): void;
  /** Report the player's death; the director freezes, then calls `respawn()`. */
  loseLife(): void;
  /** Short banner text. */
  toast(text: string): void;
}

export interface Milestone {
  cur: number;
  target: number;
  label: string;
}

/**
 * One game on the shared board. A mode plays normally until its milestone,
 * then `startMorph()` flips it into a hybrid phase where `p` grows 0→1 and the
 * rules/visuals drift toward the next game. When `ready()` the director swaps
 * in `next()`, built from this mode's live state.
 */
export abstract class Mode {
  abstract readonly id: GameId;
  morphing = false;
  p = 0;
  t = 0;
  /** Seconds of invulnerability after respawn. */
  invuln = 0;

  constructor(protected ctx: Ctx) {}

  abstract update(dt: number): void;
  abstract render(r: Renderer): void;
  abstract milestone(): Milestone;
  abstract respawn(): void;
  abstract next(): Mode;
  /** Control hint shown under the board. */
  abstract hint(): string;
  /** Text shown when the morph starts. */
  abstract morphHint(): string;

  get nextId(): GameId {
    return nextOf(this.id);
  }

  /** Palette / music / HUD blend: from `a` to `b` by `t`. */
  blend(): { a: GameId; b: GameId; t: number } {
    return this.morphing ? { a: this.id, b: this.nextId, t: this.p } : { a: this.id, b: this.id, t: 0 };
  }

  /** Whether the milestone may trigger a morph right now. */
  canMorph(): boolean {
    return !this.morphing;
  }

  startMorph() {
    this.morphing = true;
    this.p = 0;
    this.ctx.sfx.morph();
    this.ctx.fx.doFlash('#ffffff', 0.5);
    this.ctx.toast(`MORPH → ${NAMES[this.nextId]}\n${this.morphHint()}`);
    this.onMorphStart();
  }

  protected onMorphStart() {}

  advance(amount: number) {
    this.p = Math.min(1, this.p + amount);
  }

  ready(): boolean {
    return this.morphing && this.p >= 1;
  }

  /** Debug: jump to the morph, or finish it. */
  debugSkip() {
    if (!this.morphing) this.startMorph();
    else this.p = 1;
  }
}

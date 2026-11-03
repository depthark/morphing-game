import { Blocks } from '../games/blocks';
import { Bomber } from '../games/bomber';
import { Bombs } from '../games/bombs';
import { Chomper } from '../games/chomper';
import { Flapper } from '../games/flapper';
import { SHIELD_CELLS } from '../games/layout';
import { Paddle } from '../games/paddle';
import { Raid } from '../games/raid';
import { Snake } from '../games/snake';
import type { Audio } from './audio';
import { COLS, type GameId, idx, isBorder, lerp, NAMES, ROWS, T } from './constants';
import { CHOMPER_START, parseMaze } from './grid';
import type { Input } from './input';
import { Fx, type Ctx, type Mode } from './mode';
import { mixPalette, PALETTES } from './palette';
import type { Renderer } from './render';

export type Screen = 'title' | 'play' | 'pause' | 'over';

export interface HudState {
  score: number;
  best: number;
  lives: number;
  round: number;
  name: string;
  bar: number;
  morphing: boolean;
  label: string;
  hint: string;
  accent: string;
  text: string;
}

export interface HudSink {
  render(s: HudState): void;
  toast(text: string): void;
  screen(s: Screen, info: { score: number; best: number; round: number; newBest: boolean }): void;
}

const START_LIVES = 3;
const GLITCH = '#%&@*?!';

/** Blend two titles letter by letter, with a little glitch at the seam. */
export function morphText(a: string, b: string, t: number): string {
  const len = Math.round(lerp(a.length, b.length, t));
  let out = '';
  for (let i = 0; i < len; i++) {
    const th = ((i * 7 + 3) % 11) / 11;
    if (Math.abs(th - t) < 0.06 && t > 0 && t < 1) out += GLITCH[(i + Math.floor(t * 40)) % GLITCH.length];
    else out += (th < t ? b[i] : a[i]) ?? (th < t ? a[i] : b[i]) ?? ' ';
  }
  return out;
}

export class Director {
  screen: Screen = 'title';
  score = 0;
  best = 0;
  lives = START_LIVES;
  round = 1;
  fx = new Fx();
  mode: Mode;
  ctx: Ctx;
  freeze = 0;
  pendingRespawn = false;
  readyT = 0;
  overT = 0;
  newBest = false;
  debug = false;

  constructor(
    private input: Input,
    private sfx: Audio,
    private hud: HudSink,
    private startId: GameId = 'snake',
  ) {
    try {
      this.best = Number(localStorage.getItem('morph.best') ?? 0) || 0;
    } catch {
      /* storage unavailable */
    }
    this.ctx = {
      round: 1,
      speed: 1,
      input,
      sfx,
      fx: this.fx,
      addScore: (n) => {
        this.score += Math.round(n * (1 + 0.5 * (this.round - 1)));
      },
      loseLife: () => {
        this.lives--;
        this.freeze = 1.1;
        this.pendingRespawn = true;
        this.fx.doFlash('#ff3040', 0.45);
      },
      toast: (t) => this.hud.toast(t),
    };
    this.mode = this.makeMode(startId);
  }

  private setRound(r: number) {
    this.round = r;
    this.ctx.round = r;
    this.ctx.speed = 1 + 0.15 * (r - 1);
  }

  newGame() {
    this.score = 0;
    this.lives = START_LIVES;
    this.newBest = false;
    this.setRound(1);
    this.fx = new Fx();
    this.ctx.fx = this.fx;
    this.freeze = 0;
    this.pendingRespawn = false;
    this.input.clearBuffers();
    this.mode = this.makeMode(this.startId);
    this.readyT = 0.8;
    this.screen = 'play';
    this.hud.screen('play', this.info());
    this.hud.toast(`${NAMES[this.mode.id]}\n${this.mode.hint()}`);
  }

  /** Fresh instance of any game (used for the start and for ?start= debugging). */
  makeMode(id: GameId): Mode {
    const ctx = this.ctx;
    switch (id) {
      case 'snake':
        return new Snake(ctx);
      case 'chomper': {
        const m = parseMaze();
        return new Chomper(ctx, { ...m, start: CHOMPER_START, dir: 'left' });
      }
      case 'bomber': {
        const tiles = new Uint8Array(COLS * ROWS);
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const i = idx(c, r);
            if (isBorder(c, r)) tiles[i] = T.BORDER;
            else if (c % 2 === 0 && r % 2 === 0 && r <= 20) tiles[i] = T.PILLAR;
            else if (Math.random() < 0.45 && Math.abs(c - 7) + Math.abs(r - 18) > 2) tiles[i] = T.BRICK;
          }
        return new Bomber(ctx, { tiles, player: { c: 7, r: 18 }, enemies: [], bombs: new Bombs(ctx, { ray: () => 'pass', onBrick: () => {} }), face: 'down' });
      }
      case 'raid':
        return new Raid(ctx, { slots: [], shields: SHIELD_CELLS, playerX: COLS / 2 });
      case 'paddle':
        return new Paddle(ctx, { playerX: COLS / 2, ball: null });
      case 'flapper':
        return new Flapper(ctx, { x: 4, y: 10, vy: 0, pipes: [] });
      case 'blocks':
        return new Blocks(ctx);
    }
  }

  private info() {
    return { score: this.score, best: this.best, round: this.round, newBest: this.newBest };
  }

  togglePause() {
    if (this.screen === 'play') {
      this.screen = 'pause';
      this.sfx.suspend(true);
    } else if (this.screen === 'pause') {
      this.screen = 'play';
      this.sfx.suspend(false);
      this.readyT = Math.max(this.readyT, 0.4);
    } else return;
    this.hud.screen(this.screen, this.info());
  }

  pause() {
    if (this.screen === 'play') this.togglePause();
  }

  update(dt: number) {
    const input = this.input;
    if (input.wasPressed('mute')) this.sfx.toggleMute();
    if (input.wasPressed('pause')) this.togglePause();

    if (this.screen === 'title') {
      if (input.wasPressed('action')) this.newGame();
      return;
    }
    if (this.screen === 'over') {
      this.overT -= dt;
      this.fx.update(dt);
      if (this.overT <= 0 && input.wasPressed('action')) this.newGame();
      return;
    }
    if (this.screen === 'pause') {
      if (input.wasPressed('action')) this.togglePause();
      return;
    }

    this.fx.update(dt);
    if (this.freeze > 0) {
      this.freeze -= dt;
      if (this.freeze <= 0 && this.pendingRespawn) {
        this.pendingRespawn = false;
        if (this.lives <= 0) return this.gameOver();
        this.mode.respawn();
        this.readyT = 0.6;
      }
      return;
    }
    if (this.readyT > 0) {
      this.readyT -= dt;
      input.clearBuffers();
      return;
    }

    if (this.debug && input.wasPressed('skip')) this.mode.debugSkip();

    this.mode.update(dt);
    if (this.pendingRespawn) return;

    if (this.mode.canMorph()) {
      const m = this.mode.milestone();
      if (m.cur >= m.target) this.mode.startMorph();
    }
    if (this.mode.morphing && this.mode.ready()) {
      const from = this.mode.id;
      if (from === 'blocks') this.setRound(this.round + 1);
      const next = this.mode.next();
      this.mode = next;
      this.input.clearBuffers();
      this.sfx.arrive();
      this.fx.doFlash('#ffffff', 0.35);
      const loop = from === 'blocks' ? `KOLO ${this.round} · rýchlejšie!\n` : '';
      this.hud.toast(`${loop}${NAMES[next.id]}\n${next.hint()}`);
    }
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
    }
  }

  private gameOver() {
    this.screen = 'over';
    this.overT = 1.2;
    this.sfx.over();
    if (this.newBest) {
      try {
        localStorage.setItem('morph.best', String(this.best));
      } catch {
        /* ignore */
      }
    }
    this.hud.screen('over', this.info());
  }

  render(r: Renderer) {
    const b = this.mode.blend();
    const pal = mixPalette(PALETTES[b.a], PALETTES[b.b], b.t);
    const s = this.fx.shake;
    r.begin(pal, s ? (Math.random() - 0.5) * s : 0, s ? (Math.random() - 0.5) * s : 0);
    this.mode.render(r);
    this.fx.render(r);
    if (this.fx.flash > 0) {
      r.alpha(this.fx.flash);
      r.rect(-8, -8, COLS * 8 + 16, ROWS * 8 + 16, this.fx.flashColor);
      r.alpha(1);
    }
    this.sfx.setMusic(b.a, b.b, b.t);

    const m = this.mode.milestone();
    const morphing = b.t > 0 || this.mode.morphing;
    this.hud.render({
      score: this.score,
      best: this.best,
      lives: this.lives,
      round: this.round,
      name: morphText(NAMES[b.a], NAMES[b.b], b.t),
      bar: morphing ? 1 - b.t : Math.min(1, m.cur / Math.max(1, m.target)),
      morphing,
      label: morphing ? `MORPH → ${NAMES[b.b]}` : `${m.label} ${m.cur}/${m.target}`,
      hint: this.mode.hint(),
      accent: pal.accent,
      text: pal.player,
    });
  }
}

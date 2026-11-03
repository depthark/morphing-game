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
import { COLS, type GameId, idx, isBorder, lerp, NAMES, ORDER, ROWS, T } from './constants';
import { CHOMPER_START, parseMaze } from './grid';
import type { Input } from './input';
import { Fx, type Ctx, type Mode } from './mode';
import { mixPalette, PALETTES } from './palette';
import type { Renderer, SpriteColors } from './render';
import { rotate, SPR, type Sprite } from './sprites';

export type Screen = 'title' | 'play' | 'pause' | 'over' | 'win';

export interface HudState {
  score: number;
  best: number;
  lives: number;
  maxLives: number;
  /** 1-based position of the current game in the chain. */
  stage: number;
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
  screen(s: Screen, info: ScreenInfo): void;
}

export interface ScreenInfo {
  score: number;
  best: number;
  newBest: boolean;
  stage: number;
  lifeBonus: number;
}

export const START_LIVES = 5;
const LIFE_BONUS = 1000;
const CONFETTI = ['#ffd23f', '#46e0ff', '#ff5fd7', '#8dff6a', '#ff5c6c', '#ffffff'];
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
  lifeBonus = 0;
  winT = 0;
  fireworkT = 0;
  cheated = false;
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
    this.lifeBonus = 0;
    this.cheated = false;
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
    return { score: this.score, best: this.best, newBest: this.newBest, stage: ORDER.indexOf(this.mode.id) + 1, lifeBonus: this.lifeBonus };
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
    if (this.screen === 'over' || this.screen === 'win') {
      this.overT -= dt;
      this.fx.update(dt);
      if (this.screen === 'win') this.celebrate(dt);
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

    if (this.debug && input.wasPressed('skip')) {
      if (this.mode.id === ORDER[ORDER.length - 1]) return this.win();
      this.mode.debugSkip();
    }

    this.mode.update(dt);
    if (this.pendingRespawn) return;

    if (this.mode.canMorph()) {
      const m = this.mode.milestone();
      if (m.cur >= m.target) {
        // BLOCKFALL is the last game: beating it wins instead of looping.
        if (this.mode.id === ORDER[ORDER.length - 1]) return this.win();
        this.mode.startMorph();
      }
    }
    if (this.mode.morphing && this.mode.id === ORDER[ORDER.length - 1]) return this.win();
    if (this.mode.morphing && this.mode.ready()) {
      const next = this.mode.next();
      this.mode = next;
      this.input.clearBuffers();
      this.sfx.arrive();
      this.fx.doFlash('#ffffff', 0.35);
      this.hud.toast(`${NAMES[next.id]}\n${next.hint()}`);
    }
    this.trackBest();
  }

  private trackBest() {
    if (this.score > this.best) {
      this.best = this.score;
      this.newBest = true;
    }
  }

  private saveBest() {
    if (!this.newBest) return;
    try {
      localStorage.setItem('morph.best', String(this.best));
    } catch {
      /* ignore */
    }
  }

  private celebrate(dt: number) {
    this.winT += dt;
    if (Math.random() < dt * 30) this.fx.confetti(1, CONFETTI, COLS);
    this.fireworkT -= dt;
    if (this.fireworkT <= 0) {
      this.fireworkT = 0.45 + Math.random() * 0.5;
      const color = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
      this.fx.burst(2 + Math.random() * (COLS - 4), 3 + Math.random() * 9, color, 28, 8, 7);
      this.sfx.pop();
    }
  }

  /** Classic cheat code. Works once per game; returns whether it fired. */
  konami(): boolean {
    if (this.screen !== 'play' || this.cheated) return false;
    this.cheated = true;
    this.lives += 30;
    this.sfx.power();
    this.sfx.bonus();
    this.fx.doFlash('#46e0ff', 0.6);
    this.fx.confetti(40, CONFETTI, COLS);
    this.hud.toast('↑↑↓↓←→←→BA\n+30 LIVES · CRT MODE');
    return true;
  }

  private win() {
    this.mode.morphing = false;
    this.lifeBonus = this.lives * LIFE_BONUS;
    this.score += this.lifeBonus;
    this.trackBest();
    this.screen = 'win';
    this.overT = 1.5;
    this.winT = 0;
    this.fireworkT = 0;
    this.sfx.bonus();
    this.sfx.arrive();
    this.fx.doFlash('#ffffff', 0.8);
    for (let k = 0; k < 6; k++) this.fx.burst(2 + Math.random() * (COLS - 4), 4 + Math.random() * 14, ['#ffd23f', '#46e0ff', '#ff5fd7', '#8dff6a'][k % 4], 30, 9, 6);
    this.saveBest();
    this.hud.screen('win', this.info());
  }

  private gameOver() {
    this.screen = 'over';
    this.overT = 1.2;
    this.sfx.over();
    this.saveBest();
    this.hud.screen('over', this.info());
  }

  /** Victory parade: one character from every game marching across the floor. */
  private renderParade(r: Renderer) {
    r.alpha(0.6);
    r.rect(0, 0, COLS * 8, ROWS * 8, '#000000');
    r.alpha(1);
    const t = this.winT;
    const span = COLS + 22;
    const step = Math.floor(t * 8) % 2;
    const cast: [Sprite, SpriteColors][] = [
      [rotate(step ? SPR.chompOpen : SPR.chompClosed, 0), { X: PALETTES.chomper.player }],
      [step ? SPR.spook : SPR.spook2, { X: '#ff5d5d', w: '#ffffff', o: '#1a1a40' }],
      [SPR.bomberman, { X: '#f4f4f4', o: '#4aa3ff', w: '#101018' }],
      [SPR.balloon, { X: PALETTES.bomber.enemy, o: '#2b1a10' }],
      [step ? SPR.alienA1 : SPR.alienA2, { X: PALETTES.raid.enemy, o: '#02030c' }],
      [SPR.ship, { X: PALETTES.raid.player, o: '#c6ffe0' }],
      [step ? SPR.bird1 : SPR.bird2, { X: PALETTES.flapper.player, o: PALETTES.flapper.player2 }],
    ];
    const baseY = 20;
    // snake leads the parade
    const head = ((t * 3) % span) - 4;
    for (let k = 0; k < 5; k++) r.cell(Math.floor(head - k), baseY, k % 2 ? PALETTES.snake.player2 : PALETTES.snake.player, 1);
    cast.forEach(([spr, col], k) => {
      const x = (((t * 3 - 2.2 * (k + 3)) % span) + span) % span - 4;
      const bob = Math.abs(Math.sin(t * 8 + k)) * 0.5;
      r.spriteAt(spr, x, baseY - bob, col);
    });
    // a T-piece and a ball bring up the rear
    const tx = (((t * 3 - 2.2 * (cast.length + 3)) % span) + span) % span - 4;
    for (const [c, y] of [[0, 1], [1, 1], [2, 1], [1, 0]]) r.block(tx + c - 1, baseY - 1 + y, '#c15cff');
    const bx = (((t * 3 - 2.2 * (cast.length + 5)) % span) + span) % span - 4;
    r.disc(bx * 8 + 4, (baseY + 0.5 - Math.abs(Math.sin(t * 6)) * 2) * 8, 2, '#ffffff');
    // floor
    for (let x = 0; x < COLS; x++) r.block(x, baseY + 1, x % 2 ? '#2b2b5c' : '#4b4b8f');
  }

  render(r: Renderer) {
    const b = this.mode.blend();
    const pal = mixPalette(PALETTES[b.a], PALETTES[b.b], b.t);
    const s = this.fx.shake;
    r.begin(pal, s ? (Math.random() - 0.5) * s : 0, s ? (Math.random() - 0.5) * s : 0);
    this.mode.render(r);
    if (this.screen === 'win') this.renderParade(r);
    this.fx.render(r);
    if (this.fx.flash > 0) {
      r.alpha(this.fx.flash);
      r.rect(-8, -8, COLS * 8 + 16, ROWS * 8 + 16, this.fx.flashColor);
      r.alpha(1);
    }
    this.sfx.setMusic(b.a, b.b, b.t);

    const m = this.mode.milestone();
    const won = this.screen === 'win';
    const morphing = !won && (b.t > 0 || this.mode.morphing);
    this.hud.render({
      score: this.score,
      best: this.best,
      lives: this.lives,
      maxLives: START_LIVES,
      stage: ORDER.indexOf(b.t > 0.5 ? b.b : b.a) + 1,
      name: morphText(NAMES[b.a], NAMES[b.b], b.t),
      bar: won ? 1 : morphing ? 1 - b.t : Math.min(1, m.cur / Math.max(1, m.target)),
      morphing,
      label: won ? 'ALL 7 GAMES CLEARED' : morphing ? `MORPH → ${NAMES[b.b]}` : `${m.label} ${m.cur}/${m.target}`,
      hint: won ? 'Thanks for playing!' : this.mode.hint(),
      accent: pal.accent,
      text: pal.player,
    });
  }
}

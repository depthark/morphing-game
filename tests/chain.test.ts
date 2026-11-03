import { describe, expect, it } from 'vitest';
import { Audio } from '../src/core/audio';
import { COLS, DIRS, type GameId, idx, ORDER, ROWS, T } from '../src/core/constants';
import { Director, type HudSink, morphText } from '../src/core/director';
import { MAZE, parseMaze } from '../src/core/grid';
import { Input } from '../src/core/input';
import { Renderer } from '../src/core/render';

const noopCtx = new Proxy(
  {},
  {
    get: () => () => {},
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;

const hud: HudSink = { render() {}, toast() {}, screen() {} };

function sim(start: GameId) {
  const input = new Input();
  const d = new Director(input, new Audio(), hud, start);
  d.debug = true;
  d.newGame();
  const r = new Renderer(noopCtx);
  const seen: GameId[] = [d.mode.id];
  const dt = 1 / 60;
  let t = 0;
  let sinceSwitch = 0;
  let frames = 0;
  while (d.screen !== 'win' && t < 3000) {
    d.lives = 99;
    frames++;
    // pseudo-player: mash inputs
    if (frames % 9 === 0) input.press(DIRS[Math.floor(Math.random() * 4)]);
    if (frames % 13 === 0) input.press('action');
    if (frames % 20 === 0) input.held.has('left') ? input.held.delete('left') : input.held.add('left');
    // skip to the morph after a few seconds of normal play
    if (!d.mode.morphing && sinceSwitch > 4 && d.mode.canMorph()) input.press('skip');
    d.update(dt);
    input.endFrame();
    if (frames % 5 === 0) d.render(r);
    t += dt;
    sinceSwitch += dt;
    if (d.mode.id !== seen[seen.length - 1]) {
      seen.push(d.mode.id);
      expect(sinceSwitch, `morph into ${d.mode.id} took too long`).toBeLessThan(240);
      sinceSwitch = 0;
    }
  }
  return { seen, d };
}

describe('morph chain', () => {
  it('plays through every game and transition, then wins (no loop)', () => {
    const { seen, d } = sim('snake');
    expect(seen).toEqual(ORDER);
    expect(d.screen).toBe('win');
    expect(d.mode.id).toBe('blocks');
    expect(d.lifeBonus).toBe(d.lives * 1000);
    expect(d.score).toBeGreaterThan(0);
  });

  it.each(ORDER)('can start directly at %s and reach the win screen', (id) => {
    const { seen, d } = sim(id);
    expect(seen).toEqual(ORDER.slice(ORDER.indexOf(id)));
    expect(d.screen).toBe('win');
  });

  it('starts with 5 lives and the Konami code adds 30 once', () => {
    const input = new Input();
    const d = new Director(input, new Audio(), hud, 'snake');
    d.newGame();
    expect(d.lives).toBe(5);
    expect(d.konami()).toBe(true);
    expect(d.lives).toBe(35);
    expect(d.konami()).toBe(false);
    expect(d.lives).toBe(35);
  });

  it('keeps celebrating on the win screen without errors', () => {
    const { d } = sim('blocks');
    const r = new Renderer(noopCtx);
    for (let k = 0; k < 600; k++) {
      d.update(1 / 60);
      d.render(r);
    }
    expect(d.fx.parts.length).toBeGreaterThan(0);
  });
});

describe('maze', () => {
  it('is 15×24, symmetric, connected and has no dead ends', () => {
    expect(MAZE.length).toBe(ROWS);
    for (const row of MAZE) {
      expect(row.length).toBe(COLS);
      expect([...row].reverse().join('')).toBe(row);
    }
    const { tiles } = parseMaze();
    const open = (c: number, r: number) => c >= 0 && r >= 0 && c < COLS && r < ROWS && tiles[idx(c, r)] === T.EMPTY;
    const cells: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (open(c, r)) cells.push([c, r]);
    for (const [c, r] of cells) {
      const n = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => open(c + dx, r + dy)).length;
      expect(n, `dead end at ${c},${r}`).toBeGreaterThanOrEqual(2);
    }
    const seen = new Set([cells[0].join()]);
    const q = [cells[0]];
    while (q.length) {
      const [c, r] = q.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const k: [number, number] = [c + dx, r + dy];
        if (open(...k) && !seen.has(k.join())) {
          seen.add(k.join());
          q.push(k);
        }
      }
    }
    expect(seen.size).toBe(cells.length);
  });
});

describe('morphText', () => {
  it('goes from one title to the other', () => {
    expect(morphText('SNAKE', 'CHOMPER', 0)).toBe('SNAKE');
    expect(morphText('SNAKE', 'CHOMPER', 1)).toBe('CHOMPER');
  });
});

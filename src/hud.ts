import type { HudSink, HudState, Screen, ScreenInfo } from './core/director';
import { NAMES, ORDER } from './core/constants';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM HUD: score + milestone bar on top, hint line below, overlay screens. */
export class DomHud implements HudSink {
  private el = {
    root: document.documentElement,
    score: $('score'),
    best: $('best'),
    lives: $('lives'),
    round: $('round'),
    name: $('gname'),
    fill: $('bar-fill'),
    bar: $('bar'),
    label: $('mlabel'),
    hint: $('hint'),
    screen: $('screen'),
  };
  private last: Partial<Record<keyof HudState, unknown>> = {};
  private toastText = '';
  private toastUntil = 0;

  private set<K extends keyof HudState>(k: K, v: HudState[K], apply: (v: HudState[K]) => void) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    apply(v);
  }

  render(s: HudState) {
    const e = this.el;
    this.set('score', s.score, (v) => (e.score.textContent = String(v).padStart(6, '0')));
    this.set('best', s.best, (v) => (e.best.textContent = `HI ${v}`));
    this.set('lives', s.lives, (v) => (e.lives.textContent = v > s.maxLives ? `♥×${v}` : '♥'.repeat(Math.max(0, v)) + '♡'.repeat(Math.max(0, s.maxLives - v))));
    this.set('stage', s.stage, (v) => (e.round.textContent = `GAME ${v}/${ORDER.length}`));
    this.set('name', s.name, (v) => (e.name.textContent = v));
    this.set('bar', Math.round(s.bar * 200) / 200, (v) => (e.fill.style.transform = `scaleX(${v})`));
    this.set('morphing', s.morphing, (v) => e.bar.classList.toggle('morph', v));
    this.set('label', s.label, (v) => (e.label.textContent = v));
    const toasting = performance.now() < this.toastUntil;
    this.set('hint', toasting ? this.toastText : s.hint, (v) => (e.hint.textContent = v));
    e.hint.classList.toggle('flash', toasting);
    this.set('accent', s.accent, (v) => e.root.style.setProperty('--accent', v));
    this.set('text', s.text, (v) => e.root.style.setProperty('--text', v));
  }

  /** Short message shown in the hint line under the board (never over the game). */
  toast(text: string) {
    this.toastText = text.split('\n').join(' · ');
    this.toastUntil = performance.now() + 2600;
  }

  screen(s: Screen, info: ScreenInfo) {
    const el = this.el.screen;
    el.hidden = s === 'play';
    el.classList.toggle('win', s === 'win');
    if (s === 'play') return;
    const chain = ORDER.map((id) => NAMES[id]).join(' → ') + ' → MASTER';
    if (s === 'title') {
      el.innerHTML = `
        <h1>MORPH</h1>
        <p class="chain">${chain}</p>
        <p>Hit the milestone and the game starts changing right under your hands.<br>Score and 5 lives carry across all 7 games.</p>
        <p class="blink">SPACE / TAP = START</p>
        <p class="small">arrows / WASD · SPACE action · P pause · M sound<br>on mobile: swipe, tap, drag</p>`;
    } else if (s === 'pause') {
      el.innerHTML = `<h2>PAUSED</h2><p class="blink">SPACE / TAP = RESUME</p>`;
    } else if (s === 'win') {
      el.innerHTML = `
        <h2 class="win">YOU ARE THE<br>MASTER OF<br>RETRO GAMES</h2>
        <p class="chain">${chain}</p>
        <p class="big">${info.score}</p>
        <p>lives bonus +${info.lifeBonus} · ${info.newBest ? 'NEW HIGH SCORE!' : `best ${info.best}`}</p>
        <p class="blink">SPACE / TAP = PLAY AGAIN</p>`;
    } else {
      el.innerHTML = `
        <h2>GAME OVER</h2>
        <p class="big">${info.score}</p>
        <p>${info.newBest ? 'NEW HIGH SCORE!' : `best ${info.best}`} · reached game ${info.stage}/${ORDER.length}</p>
        <p class="blink">SPACE / TAP = PLAY AGAIN</p>`;
    }
  }
}

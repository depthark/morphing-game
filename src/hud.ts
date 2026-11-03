import type { HudSink, HudState, Screen } from './core/director';
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
    toast: $('toast'),
    screen: $('screen'),
  };
  private last: Partial<Record<keyof HudState, unknown>> = {};
  private toastTimer = 0;

  private set<K extends keyof HudState>(k: K, v: HudState[K], apply: (v: HudState[K]) => void) {
    if (this.last[k] === v) return;
    this.last[k] = v;
    apply(v);
  }

  render(s: HudState) {
    const e = this.el;
    this.set('score', s.score, (v) => (e.score.textContent = String(v).padStart(6, '0')));
    this.set('best', s.best, (v) => (e.best.textContent = `HI ${v}`));
    this.set('lives', s.lives, (v) => (e.lives.textContent = '♥'.repeat(Math.max(0, v)) + '♡'.repeat(Math.max(0, 3 - v))));
    this.set('round', s.round, (v) => (e.round.textContent = `KOLO ${v}`));
    this.set('name', s.name, (v) => (e.name.textContent = v));
    this.set('bar', Math.round(s.bar * 200) / 200, (v) => (e.fill.style.transform = `scaleX(${v})`));
    this.set('morphing', s.morphing, (v) => e.bar.classList.toggle('morph', v));
    this.set('label', s.label, (v) => (e.label.textContent = v));
    this.set('hint', s.hint, (v) => (e.hint.textContent = v));
    this.set('accent', s.accent, (v) => e.root.style.setProperty('--accent', v));
    this.set('text', s.text, (v) => e.root.style.setProperty('--text', v));
  }

  toast(text: string) {
    const t = this.el.toast;
    t.replaceChildren(
      ...text.split('\n').map((line, i) => {
        const d = document.createElement('div');
        d.textContent = line;
        if (i === 0) d.className = 'toast-head';
        return d;
      }),
    );
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
  }

  screen(s: Screen, info: { score: number; best: number; round: number; newBest: boolean }) {
    const el = this.el.screen;
    el.hidden = s === 'play';
    if (s === 'play') return;
    const chain = ORDER.map((id) => NAMES[id]).join(' → ') + ' → ↺';
    if (s === 'title') {
      el.innerHTML = `
        <h1>MORPH</h1>
        <p class="chain">${chain}</p>
        <p>Splň míľnik a hra sa ti začne meniť priamo pod rukami.<br>Skóre a 3 životy sú spoločné pre všetky hry.</p>
        <p class="blink">SPACE / TAP = ŠTART</p>
        <p class="small">šípky / WASD · SPACE akcia · P pauza · M zvuk<br>na mobile: swipe, tap, ťahanie prstom</p>`;
    } else if (s === 'pause') {
      el.innerHTML = `<h2>PAUZA</h2><p class="blink">SPACE / TAP = POKRAČUJ</p>`;
    } else {
      el.innerHTML = `
        <h2>GAME OVER</h2>
        <p class="big">${info.score}</p>
        <p>${info.newBest ? 'NOVÝ REKORD!' : `rekord ${info.best}`} · kolo ${info.round}</p>
        <p class="blink">SPACE / TAP = ZNOVA</p>`;
    }
  }
}

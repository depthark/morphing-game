import './style.css';
import { Audio } from './core/audio';
import { type GameId, H, ORDER, W } from './core/constants';
import { Director } from './core/director';
import { Input } from './core/input';
import { Renderer } from './core/render';
import { DomHud } from './hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const stage = document.getElementById('stage')!;
canvas.width = W;
canvas.height = H;
const g = canvas.getContext('2d')!;
g.imageSmoothingEnabled = false;

const params = new URLSearchParams(location.search);
const startParam = params.get('start') as GameId | null;
const start: GameId = startParam && ORDER.includes(startParam) ? startParam : 'snake';

const renderer = new Renderer(g);
const input = new Input();
const audio = new Audio();
const hud = new DomHud();
const director = new Director(input, audio, hud, start);
director.debug = params.has('debug');

input.attach(stage, () => canvas.getBoundingClientRect());
input.onAnyPress = () => audio.unlock();

const muteBtn = document.getElementById('mute') as HTMLButtonElement;
const syncMute = () => {
  muteBtn.textContent = audio.muted ? '♪̸' : '♪';
  muteBtn.setAttribute('aria-pressed', String(audio.muted));
};
syncMute();
muteBtn.addEventListener('click', () => {
  audio.unlock();
  audio.toggleMute();
  syncMute();
});
window.addEventListener('keydown', (e) => e.code === 'KeyM' && requestAnimationFrame(syncMute));
document.getElementById('pause-btn')!.addEventListener('click', () => director.togglePause());
document.addEventListener('visibilitychange', () => document.hidden && director.pause());

/** Integer pixel scaling in device pixels for crisp pixels; fractional fallback on tiny screens. */
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const s = Math.floor(Math.min((w * dpr) / W, (h * dpr) / H));
  const scale = s >= 2 ? s / dpr : Math.min(w / W, h / H);
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}
new ResizeObserver(resize).observe(stage);
resize();

hud.screen('title', { score: 0, best: director.best, newBest: false, stage: 1, lifeBonus: 0 });

// Easter egg: the Konami code (or 7 quick taps on the game title on mobile)
// gives 30 extra lives and switches on a CRT monitor look.
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
let konamiPos = 0;
const cheat = () => {
  if (director.konami()) document.body.classList.add('crt');
};
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === KONAMI[konamiPos]) konamiPos++;
  else if (!(e.code === 'ArrowUp' && konamiPos === 2)) konamiPos = e.code === KONAMI[0] ? 1 : 0;
  if (konamiPos === KONAMI.length) {
    konamiPos = 0;
    cheat();
  }
});
let taps: number[] = [];
document.getElementById('gname')!.addEventListener('pointerdown', () => {
  const now = performance.now();
  taps = [...taps.filter((t) => now - t < 2500), now];
  if (taps.length >= 7) {
    taps = [];
    cheat();
  }
});

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  director.update(dt);
  input.endFrame();
  director.render(renderer);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

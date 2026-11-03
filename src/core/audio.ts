import type { GameId } from './constants';

// Tiny WebAudio chiptune engine: procedural SFX + one looping track per game.
// During a morph both tracks play with crossfaded gain and blended tempo.

type Note = number | null; // semitones relative to A2 (110 Hz)
interface Track {
  bpm: number;
  bassWave: OscillatorType;
  leadWave: OscillatorType;
  bass: Note[];
  lead: Note[];
}

const _ = null;
const TRACKS: Record<GameId, Track> = {
  snake: {
    bpm: 118,
    bassWave: 'triangle',
    leadWave: 'square',
    bass: [0, _, 0, _, 7, _, 0, _, 5, _, 5, _, 3, _, 7, _],
    lead: [12, _, 15, _, 19, _, 15, _, 17, _, 15, 12, 14, _, _, _],
  },
  chomper: {
    bpm: 132,
    bassWave: 'triangle',
    leadWave: 'square',
    bass: [0, _, 12, _, 3, _, 15, _, 5, _, 17, _, 7, _, 19, _],
    lead: [24, 27, 31, _, 29, 27, 24, _, 26, 29, 31, _, 34, _, 31, _],
  },
  bomber: {
    bpm: 140,
    bassWave: 'square',
    leadWave: 'triangle',
    bass: [0, 0, _, 0, 3, _, 5, _, 0, 0, _, 0, 7, _, 5, 3],
    lead: [12, _, 14, 15, _, 19, _, 17, 15, _, 14, _, 12, _, _, _],
  },
  raid: {
    bpm: 96,
    bassWave: 'square',
    leadWave: 'sawtooth',
    bass: [0, _, _, _, -2, _, _, _, -4, _, _, _, -5, _, _, _],
    lead: [_, _, 24, _, _, _, 22, _, _, _, 20, _, _, 19, _, _],
  },
  paddle: {
    bpm: 108,
    bassWave: 'square',
    leadWave: 'square',
    bass: [0, _, _, 0, _, _, 7, _, 5, _, _, 5, _, _, 3, _],
    lead: [_, 19, _, _, 24, _, _, _, _, 22, _, _, 19, _, _, _],
  },
  flapper: {
    bpm: 124,
    bassWave: 'triangle',
    leadWave: 'triangle',
    bass: [0, _, 7, _, 4, _, 7, _, 5, _, 9, _, 7, _, 11, _],
    lead: [24, 28, 31, _, 28, _, 26, _, 29, 26, 24, _, 23, _, 26, _],
  },
  blocks: {
    bpm: 144,
    bassWave: 'triangle',
    leadWave: 'square',
    bass: [0, 12, 0, 12, 3, 15, 3, 15, 5, 17, 5, 17, 7, 19, 7, 19],
    lead: [24, _, 19, 20, 22, _, 20, 19, 17, _, 17, 20, 24, _, 22, 20],
  },
};

const freq = (n: number) => 110 * Math.pow(2, n / 12);

export class Audio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;
  private a: GameId = 'snake';
  private b: GameId = 'snake';
  private mixT = 0;
  private step = 0;
  private nextTime = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem('morph.muted') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.nextTime = this.ctx.currentTime + 0.05;
      window.setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('morph.muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  setMusic(a: GameId, b: GameId, t: number) {
    this.a = a;
    this.b = b;
    this.mixT = t;
  }

  suspend(on: boolean) {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const ta = TRACKS[this.a];
    const tb = TRACKS[this.b];
    const bpm = ta.bpm + (tb.bpm - ta.bpm) * this.mixT;
    const stepDur = 60 / bpm / 4;
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.02;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const s = this.step % 16;
      this.playStep(ta, s, this.nextTime, stepDur, 1 - this.mixT);
      if (this.b !== this.a && this.mixT > 0) this.playStep(tb, s, this.nextTime, stepDur, this.mixT);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(t: Track, s: number, at: number, dur: number, gain: number) {
    if (gain <= 0.01) return;
    const bn = t.bass[s];
    const ln = t.lead[s];
    if (bn !== null && bn !== undefined) this.tone(freq(bn), at, dur * 1.6, t.bassWave, 0.09 * gain);
    if (ln !== null && ln !== undefined) this.tone(freq(ln), at, dur * 0.9, t.leadWave, 0.045 * gain);
  }

  private tone(f: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, vol: number, lowpass = 1800) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(at);
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---- SFX -------------------------------------------------------------
  eat() {
    this.tone(660, this.now(), 0.07, 'square', 0.12, 990);
  }
  dot() {
    this.tone(880, this.now(), 0.03, 'square', 0.05);
  }
  bonus() {
    const t = this.now();
    this.tone(523, t, 0.08, 'square', 0.12);
    this.tone(784, t + 0.07, 0.08, 'square', 0.12);
    this.tone(1046, t + 0.14, 0.12, 'square', 0.12);
  }
  power() {
    this.tone(220, this.now(), 0.35, 'sawtooth', 0.1, 880);
  }
  shoot() {
    this.tone(1200, this.now(), 0.09, 'square', 0.07, 300);
  }
  hit() {
    this.tone(320, this.now(), 0.05, 'square', 0.1, 500);
  }
  wall() {
    this.tone(200, this.now(), 0.04, 'square', 0.08);
  }
  explode() {
    this.noise(this.now(), 0.35, 0.35, 900);
  }
  pop() {
    this.noise(this.now(), 0.08, 0.2, 3000);
  }
  flap() {
    this.tone(420, this.now(), 0.08, 'triangle', 0.12, 700);
  }
  line(n: number) {
    const t = this.now();
    for (let i = 0; i < n + 1; i++) this.tone(523 * Math.pow(1.25, i), t + i * 0.06, 0.1, 'square', 0.1);
  }
  die() {
    this.tone(500, this.now(), 0.6, 'square', 0.14, 60);
  }
  morph() {
    const t = this.now();
    this.tone(110, t, 0.9, 'sawtooth', 0.12, 880);
    this.tone(165, t + 0.05, 0.9, 'square', 0.06, 1320);
  }
  arrive() {
    const t = this.now();
    [0, 4, 7, 12].forEach((n, i) => this.tone(freq(24 + n), t + i * 0.07, 0.18, 'square', 0.1));
  }
  over() {
    const t = this.now();
    [12, 7, 3, 0].forEach((n, i) => this.tone(freq(12 + n), t + i * 0.18, 0.3, 'triangle', 0.15));
  }
}

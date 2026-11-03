import { COLS, type Dir } from './constants';

export type Key = Dir | 'action' | 'rotcw' | 'rotccw' | 'pause' | 'mute' | 'skip';

const KEYMAP: Record<string, Key> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'action',
  Enter: 'action',
  KeyX: 'rotcw',
  KeyZ: 'rotccw',
  KeyY: 'rotccw',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  KeyN: 'skip',
};

const DIR_KEYS: Dir[] = ['up', 'down', 'left', 'right'];
const SWIPE_PX = 26;
const TAP_MS = 280;

/**
 * Unified keyboard + touch input.
 * - `held` / `pressed`: classic key state (pressed = went down this frame).
 * - `dirQueue`: buffered direction presses (keyboard + swipes) for grid games.
 * - Touch: swipes emit directions and set `stickyDir`, taps emit `action`,
 *   and `pointerX` tracks the finger in board cells for paddle-like games.
 */
export class Input {
  held = new Set<Key>();
  pressed = new Set<Key>();
  dirQueue: Dir[] = [];
  heldDirs: Dir[] = [];
  swipes: Dir[] = [];
  stickyDir: Dir | null = null;
  pointerX: number | null = null;
  touching = false;
  lastSource: 'key' | 'touch' = 'key';
  onAnyPress: (() => void) | null = null;

  private touchStart = { x: 0, y: 0, t: 0, moved: false };
  private pointerId: number | null = null;

  attach(target: HTMLElement, board: () => DOMRect) {
    window.addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      this.lastSource = 'key';
      if (e.repeat) return;
      this.press(k);
      this.held.add(k);
      if (isDir(k)) {
        this.heldDirs = this.heldDirs.filter((d) => d !== k);
        this.heldDirs.push(k);
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      this.held.delete(k);
      if (isDir(k)) this.heldDirs = this.heldDirs.filter((d) => d !== k);
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.heldDirs = [];
    });

    const toCells = (clientX: number) => {
      const r = board();
      return ((clientX - r.left) / r.width) * COLS;
    };
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      this.pointerId = e.pointerId;
      this.lastSource = 'touch';
      this.touching = true;
      this.touchStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      this.pointerX = toCells(e.clientX);
      this.onAnyPress?.();
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerX = toCells(e.clientX);
      const dx = e.clientX - this.touchStart.x;
      const dy = e.clientY - this.touchStart.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX) {
        const d: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        this.press(d);
        this.swipes.push(d);
        this.stickyDir = d;
        this.touchStart.x = e.clientX;
        this.touchStart.y = e.clientY;
        this.touchStart.moved = true;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.touching = false;
      this.pointerX = null;
      if (!this.touchStart.moved && performance.now() - this.touchStart.t < TAP_MS) this.press('action');
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  }

  press(k: Key) {
    this.pressed.add(k);
    if (isDir(k)) {
      this.dirQueue.push(k);
      if (this.dirQueue.length > 4) this.dirQueue.shift();
    }
    if (k !== 'mute' && k !== 'pause') this.onAnyPress?.();
  }

  /** Next buffered direction (keyboard press or swipe). */
  takeDir(): Dir | undefined {
    return this.dirQueue.shift();
  }

  /** Direction currently held: last held key, or the sticky swipe direction on touch. */
  heldDir(): Dir | null {
    if (this.heldDirs.length) return this.heldDirs[this.heldDirs.length - 1];
    return this.lastSource === 'touch' ? this.stickyDir : null;
  }

  wasPressed(k: Key) {
    return this.pressed.has(k);
  }

  isHeld(k: Key) {
    return this.held.has(k);
  }

  /** Horizontal intent in [-1, 1] from keys. */
  axisX(): number {
    return (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
  }

  /** Call when switching game so stale inputs don't leak into the next one. */
  clearBuffers() {
    this.dirQueue = [];
    this.swipes = [];
    this.stickyDir = null;
  }

  endFrame() {
    this.pressed.clear();
    this.swipes = [];
  }
}

function isDir(k: Key): k is Dir {
  return (DIR_KEYS as string[]).includes(k);
}

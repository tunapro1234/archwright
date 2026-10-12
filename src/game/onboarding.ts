// The first minute, taught without a word. On the very first level a see-through hand shows the
// move once: it pinches the first stone of the solution out of the tray and seats it on its open
// face. If the player's hands are in view and nothing has been picked up 12 s later, it shows it
// again, three times at most; the first real grab ends the lesson for good. Hands out of view
// (resting in the lap) are idle time that does not count. Once an arch is closed, a hand near the
// centering makes it glow, on every level, until the player has struck an arch once.
//
// Pure data and functions, no clock: time comes in as `tick` events, so the same events always give
// the same state. The storage is passed in, and nothing here throws: a missing, blocked or corrupt
// save reads as a first visit, and a failed write returns false.
import type { ProgressStorage } from './progress.js';

export const ONBOARD_KEY = 'archwright.onboard.v1';
/** Seconds of idle, hands-in-view time before the ghost hand shows the move again. */
export const GHOST_REPEAT_S = 12;
/** The ghost hand shows the move at most this many times. */
export const GHOST_MAX = 3;
/** The only level the ghost hand appears on. */
export const GHOST_LEVEL = 'w1-1';

export interface Onboard {
  ghostShown: number;  // times the ghost hand has played the move
  grabbed: boolean;    // the player has picked up a stone
  struck: boolean;     // the player has struck an arch
  idleS: number;       // hands-in-view seconds since the ghost last played (or since the start)
}

export type OnboardEvent =
  | { type: 'tick'; dt: number; handsVisible: boolean }
  | { type: 'ghost-played' }
  | { type: 'grab' }
  | { type: 'strike' };

export type OnboardCue = 'ghost-grab' | 'glow-centering' | 'none';

export interface CueContext {
  level: string;
  phase: 'building' | 'ready' | 'held' | 'collapsed';
  handNearCentering: boolean;
}

export function initialOnboard(): Onboard {
  return { ghostShown: 0, grabbed: false, struck: false, idleS: 0 };
}

/** The state after `ev`; `o` is left as it was. */
export function step(o: Onboard, ev: OnboardEvent): Onboard {
  switch (ev.type) {
    case 'tick':
      if (!ev.handsVisible || o.grabbed || o.ghostShown >= GHOST_MAX || !(ev.dt > 0)) return o;
      return { ...o, idleS: o.idleS + ev.dt };
    case 'ghost-played':
      return { ...o, ghostShown: Math.min(GHOST_MAX, o.ghostShown + 1), idleS: 0 };
    case 'grab':
      return o.grabbed ? o : { ...o, grabbed: true };
    case 'strike':
      return o.struck ? o : { ...o, struck: true };
  }
}

/** What to show now: the ghost hand's move, the centering's glow, or nothing. */
export function cue(o: Onboard, c: CueContext): OnboardCue {
  if (c.level === GHOST_LEVEL && c.phase === 'building' && !o.grabbed && o.ghostShown < GHOST_MAX
    && (o.ghostShown === 0 || o.idleS >= GHOST_REPEAT_S)) return 'ghost-grab';
  if (c.phase === 'ready' && c.handNearCentering && !o.struck) return 'glow-centering';
  return 'none';
}

/** The saved state; a first visit's for anything missing, unreadable or out of range. */
export function loadOnboard(storage: ProgressStorage | null): Onboard {
  let raw: unknown;
  try {
    const text = storage?.getItem(ONBOARD_KEY);
    if (!text) return initialOnboard();
    raw = JSON.parse(text);
  } catch {
    return initialOnboard();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return initialOnboard();
  const r = raw as Record<string, unknown>;
  const { ghostShown, grabbed, struck, idleS } = r;
  if (!Number.isInteger(ghostShown) || (ghostShown as number) < 0 || (ghostShown as number) > GHOST_MAX) return initialOnboard();
  if (typeof grabbed !== 'boolean' || typeof struck !== 'boolean') return initialOnboard();
  if (typeof idleS !== 'number' || !Number.isFinite(idleS) || idleS < 0) return initialOnboard();
  return { ghostShown: ghostShown as number, grabbed, struck, idleS };
}

/** Write `o`; false if the storage is missing or refuses it. */
export function saveOnboard(storage: ProgressStorage | null, o: Onboard): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ONBOARD_KEY, JSON.stringify({ ghostShown: o.ghostShown, grabbed: o.grabbed, struck: o.struck, idleS: o.idleS }));
    return true;
  } catch {
    return false;
  }
}

// The ghost hand's move, as a pure timeline so it is tested without a renderer. It comes down from
// above and behind the stone, pinches it, carries it over a low arc to the face, lets go, and
// rises out of view. Stays inside GHOST_DURATION (≤ 4 s).
export const GHOST_DURATION = 3.8;
/** The moment the fingers meet on the stone (the soft sound plays here). */
export const GHOST_PINCH_AT = 1.1;

export interface GhostFrame {
  from: 'above' | 'stone' | 'face';
  to: 'stone' | 'face' | 'above-face';
  u: number;          // 0..1 along from → to (eased)
  lift: number;       // 0..1 of the carry arc's height at this point
  open: number;       // 1 fingers apart .. 0 thumb on index
  alpha: number;      // the hand's opacity factor
  stoneAlpha: number; // the carried ghost stone's opacity factor (0 = not shown)
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

/** Where the ghost hand is `t` seconds into its move. */
export function ghostFrame(t: number): GhostFrame {
  const alpha = Math.min(span(t, 0, 0.4), 1 - span(t, 3.3, GHOST_DURATION));
  const open = t < 2.75 ? 1 - smooth(span(t, 0.9, 1.15)) : smooth(span(t, 2.75, 3.0));
  const stoneAlpha = t < 1.15 ? 0 : 1 - span(t, 3.0, 3.3);
  if (t < 1.15) return { from: 'above', to: 'stone', u: smooth(span(t, 0, 0.9)), lift: 0, open, alpha, stoneAlpha };
  if (t < 3.0) {
    const k = span(t, 1.15, 2.75);
    return { from: 'stone', to: 'face', u: smooth(k), lift: Math.sin(Math.PI * k), open, alpha, stoneAlpha };
  }
  return { from: 'face', to: 'above-face', u: smooth(span(t, 3.0, GHOST_DURATION)), lift: 0, open, alpha, stoneAlpha };
}

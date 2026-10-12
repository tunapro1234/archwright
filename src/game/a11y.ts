// Accessibility mode, as pure functions (no three.js, no DOM): the three settings, how they are read
// from ?a11y= and saved, which palette they paint with, and the head-gaze pick.
//   gaze:         the head's ray picks the target (a stone, an open end, the centering's handle, a
//                 marker); a pinch of either hand, or a controller trigger, confirms it. The same
//                 select-then-seat steps as the desktop mouse mode (src/systems/select.ts).
//   oneHand:      every action already takes one hand; this adds hold-to-strike on the centering's
//                 handle (pinch it and hold still for HOLD_TO_STRIKE), so no pulling is needed.
//   highContrast: HIGH_CONTRAST in place of PALETTE (src/scene/palette.ts).
// The systems that use them are src/systems/a11y.ts (settings panel) and src/systems/gaze.ts.
import { HIGH_CONTRAST, PALETTE, type Palette } from '../scene/palette.js';
import type { ProgressStorage } from './progress.js';

export const A11Y_KEY = 'archwright.a11y.v1';

/** Seconds a pinch is held on the centering's handle (gaze or one-hand mode) to strike the arch. */
export const HOLD_TO_STRIKE = 0.8;

export interface A11ySettings { gaze: boolean; oneHand: boolean; highContrast: boolean }

export const defaultA11y = (): A11ySettings => ({ gaze: false, oneHand: false, highContrast: false });

const WORDS: Record<string, keyof A11ySettings> = {
  gaze: 'gaze', onehand: 'oneHand', 'one-hand': 'oneHand', contrast: 'highContrast', 'high-contrast': 'highContrast',
};

/** ?a11y=gaze,contrast,onehand: the settings it turns on (only those); unknown words are ignored. */
export function parseA11yParam(param: string | null): Partial<A11ySettings> {
  const out: Partial<A11ySettings> = {};
  for (const w of (param ?? '').split(',')) {
    const k = WORDS[w.trim().toLowerCase()];
    if (k) out[k] = true;
  }
  return out;
}

/** The saved settings; anything missing, of the wrong type or unreadable falls back to off. Never throws. */
export function loadA11y(storage: ProgressStorage | null): A11ySettings {
  const s = defaultA11y();
  if (!storage) return s;
  try {
    const raw = JSON.parse(storage.getItem(A11Y_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return s;
    for (const k of Object.keys(s) as (keyof A11ySettings)[]) if (typeof raw[k] === 'boolean') s[k] = raw[k] as boolean;
  } catch {
    return defaultA11y();
  }
  return s;
}

/** Saves the settings; false when there is no storage or it refuses. Never throws. */
export function saveA11y(storage: ProgressStorage | null, s: A11ySettings): boolean {
  if (!storage) return false;
  try {
    storage.setItem(A11Y_KEY, JSON.stringify({ gaze: s.gaze, oneHand: s.oneHand, highContrast: s.highContrast }));
    return true;
  } catch {
    return false;
  }
}

export function activePalette(s: A11ySettings): Palette {
  return s.highContrast ? HIGH_CONTRAST : PALETTE;
}

type V3 = { x: number; y: number; z: number };
export interface GazeTarget { id: string; center: V3; radius: number }

/**
 * The target the ray from `origin` along `dir` (any length) meets first: the nearest entry into a
 * target's sphere, within `maxDist` metres. Targets behind the origin or out of range are not hit.
 */
export function gazePick(origin: V3, dir: V3, targets: readonly GazeTarget[], maxDist = 1.5): string | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0)) return null;
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
  let best: string | null = null;
  let bestT = Infinity;
  for (const t of targets) {
    const ox = t.center.x - origin.x, oy = t.center.y - origin.y, oz = t.center.z - origin.z;
    const along = ox * dx + oy * dy + oz * dz;
    if (along < 0) continue;
    const off2 = ox * ox + oy * oy + oz * oz - along * along;
    const r2 = t.radius * t.radius;
    if (off2 > r2) continue;
    const enter = along - Math.sqrt(r2 - off2);
    if (enter > maxDist || enter >= bestT) continue;
    bestT = enter;
    best = t.id;
  }
  return best;
}

/**
 * Centering pull while a pinch is held on its handle for `held` seconds, from `pull0` when it began:
 * a full strike pull after HOLD_TO_STRIKE (the centering slides out as the hold goes on).
 */
export function holdPull(held: number, pull0: number, strikeAt: number, maxPull: number): number {
  return Math.max(0, Math.min(maxPull, pull0 + (Math.max(0, held) / HOLD_TO_STRIKE) * strikeAt));
}

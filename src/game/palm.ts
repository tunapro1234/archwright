// Is the palm up? Quest's system gesture is a pinch with the palm up, so that pinch never starts a game pinch
// (src/systems/hands.ts). The palm's normal comes from three joints, the wrist and the index and pinky metacarpals,
// in the world: (index - wrist) × (pinky - wrist). For a right hand that normal points out of the palm, for a left hand
// (the same joints mirrored) into it, so the left hand's is turned round. Plain numbers, no allocation: it runs per hand
// per frame. tests/palm.test.ts checks it on IWER's own hand pose, both hands.
import type { Side } from './arch-state.js';

type P = { x: number; y: number; z: number };

/** How far up the palm faces, as the y of its unit normal, above which the palm counts as up. */
export const PALM_UP = 0.6;

/** The y of the palm's unit normal (1 straight up, -1 straight down); 0 when the three joints are on one line. */
export function palmUpness(wrist: P, indexMeta: P, pinkyMeta: P, side: Side): number {
  const ax = indexMeta.x - wrist.x, ay = indexMeta.y - wrist.y, az = indexMeta.z - wrist.z;
  const bx = pinkyMeta.x - wrist.x, by = pinkyMeta.y - wrist.y, bz = pinkyMeta.z - wrist.z;
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12)) return 0;
  return (side === 'right' ? ny : -ny) / len;
}

export function isPalmUp(wrist: P, indexMeta: P, pinkyMeta: P, side: Side): boolean {
  return palmUpness(wrist, indexMeta, pinkyMeta, side) > PALM_UP;
}

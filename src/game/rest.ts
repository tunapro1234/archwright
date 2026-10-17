// Where a collapse's stones came to rest, as pure maths (no three.js): on the board, on the desk under it, or
// below. CollapseSystem (src/systems/collapse.ts) reads each falling stone's place once they are still and counts
// them into __archwright.collapse.rest.
import { BOARD } from '../scene/layout.js';

type P3 = { x: number; y: number; z: number };

/** The top of the desk under the board, world space: centre, its own size, turned by yaw (rotationY) as the desk stands. */
export interface DeskTop { cx: number; cz: number; y: number; width: number; depth: number; yaw: number }

/** Where the falling stones of a collapse ended up, and when (s after the strike). */
export interface CollapseRest { stones: number; onBoard: number; onDesk: number; below: number; settledAfter: number }

/** A stone over the board counts this far out from its edges (m). */
export const ON_BOARD_MARGIN = 0.02;
/** A stone on a top counts down to this far below it (m). */
export const ON_TOP_BELOW = 0.03;

/** Is a point in the board's frame (site local) over the board, ON_BOARD_MARGIN round it, and not under its top? */
export function overBoard(p: P3): boolean {
  return Math.abs(p.x) <= BOARD.width / 2 + ON_BOARD_MARGIN && p.z >= BOARD.zMin - ON_BOARD_MARGIN
    && p.z <= BOARD.zMax + ON_BOARD_MARGIN && p.y >= -ON_TOP_BELOW;
}

/** Is a world point over this desk top (inside its own turned rectangle) and not more than ON_TOP_BELOW under it? */
export function overDesk(d: DeskTop, p: P3): boolean {
  const c = Math.cos(d.yaw), s = Math.sin(d.yaw), dx = p.x - d.cx, dz = p.z - d.cz;
  return Math.abs(c * dx - s * dz) <= d.width / 2 && Math.abs(s * dx + c * dz) <= d.depth / 2 && p.y >= d.y - ON_TOP_BELOW;
}

/** On the board first, then on the desk (if any), else below. */
export function restPlace(local: P3, world: P3, desk: DeskTop | null): 'onBoard' | 'onDesk' | 'below' {
  if (overBoard(local)) return 'onBoard';
  return desk && overDesk(desk, world) ? 'onDesk' : 'below';
}

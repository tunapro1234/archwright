// How the board looks where it stands, as pure maths (no three.js). In passthrough, on a desk the room reports (scene
// mesh or plane), the board's grey slab would hide the real table it sits on: there it is drawn as a thin stone frame
// round its edge with a felt under the tray, and the table shows through ('frame'). Everywhere else ('solid'): the
// page's desk, the atelier, the lap tray, a picked spot (no desk under it), opaque VR, a board that overhangs its desk,
// high contrast (its palette is the legible one) and ?board=solid. The look only: the board's collider is the same.
import { BOARD } from './layout.js';
import type { SurfaceKind } from './surface-chain.js';
import type { DeskTop } from '../game/rest.js';

export type BoardStyle = 'solid' | 'frame';

/** Where the board stands: the site's world x, z and its yaw (radians, rotationY). */
export interface BoardSite { x: number; z: number; yaw: number }

export interface BoardStyleInput {
  kind: SurfaceKind;
  /** The session is see-through (environmentBlendMode not 'opaque'). */
  passthrough: boolean;
  /** The detected desk under the board, or null. */
  desk: DeskTop | null;
  site: BoardSite;
  highContrast: boolean;
  /** ?board=solid. */
  override: 'solid' | null;
}

/**
 * Does the board (BOARD.width across, BOARD.zMin..zMax deep in the site frame, turned by the site's yaw) lie inside the
 * desk top's own turned rectangle, `margin` (m) in from each of its edges?
 */
export function footprintInsideDesk(site: BoardSite, desk: DeskTop, margin = 0.01): boolean {
  const sc = Math.cos(site.yaw), ss = Math.sin(site.yaw), dc = Math.cos(desk.yaw), ds = Math.sin(desk.yaw);
  // 1 µm of slack: placeOnDesk puts the board exactly DESK_EDGE in, and its rounding must not read as an overhang.
  const hw = desk.width / 2 - margin + 1e-6, hd = desk.depth / 2 - margin + 1e-6;
  for (const u of [-BOARD.width / 2, BOARD.width / 2]) for (const v of [BOARD.zMin, BOARD.zMax]) {
    // Site frame to world (three.js rotationY), then world to the desk's own frame.
    const dx = site.x + u * sc + v * ss - desk.cx, dz = site.z - u * ss + v * sc - desk.cz;
    if (Math.abs(dc * dx - ds * dz) > hw || Math.abs(ds * dx + dc * dz) > hd) return false;
  }
  return true;
}

/** 'frame' only on a detected desk in passthrough with the whole board on it, high contrast off and no ?board=solid. */
export function boardStyle(o: BoardStyleInput): BoardStyle {
  const frame = o.passthrough && (o.kind === 'mesh' || o.kind === 'plane') && o.desk !== null
    && !o.highContrast && o.override !== 'solid' && footprintInsideDesk(o.site, o.desk);
  return frame ? 'frame' : 'solid';
}

/** ?board=solid: the solid board everywhere. */
export function parseBoardParam(v: string | null): 'solid' | null {
  return v === 'solid' ? 'solid' : null;
}

// Where the board goes, as a pure decision (no three.js, no WebXR): SurfaceSystem gathers what the
// session offers and calls chooseSurface every frame until the board has a place.
//
// The fallback chain, in order:
//   outside XR (desktop, emulator page)  → desk: the page's own virtual desk
//   ?surface=<kind>                      → that kind (lap placed now, atelier unplaced, pick waits for a pick)
//   opaque VR (no passthrough)           → atelier: a virtual room with a wooden desk
//   a real desk (mesh first, then plane) → on it, if its centre is not behind the player (placeOnDesk)
//   first 1.5 s                          → wait for the room data to arrive
//   hit-test, up to 9.5 s                → pick: the player pinches a spot on their desk
//   otherwise                            → lap: a tray 40 cm ahead, 42 cm below the eyes

import { BOARD } from './layout.js';

export type Vec3 = { x: number; y: number; z: number };
export type SurfaceKind = 'desk' | 'atelier' | 'mesh' | 'plane' | 'pick' | 'lap';

export interface SurfaceCandidate {
  /** Centre of the top face, world metres. */
  x: number; y: number; z: number;
  width: number; depth: number;
  horizontal: boolean;
  source: 'mesh' | 'plane';
}

export interface SurfaceInput {
  inXR: boolean;
  passthrough: boolean;
  head: Vec3;
  /** Horizontal unit vector the player faces. */
  fwd: { x: number; z: number };
  candidates: SurfaceCandidate[];
  hitTest: boolean;
  picked?: Vec3;
  /** Seconds since the session started. */
  elapsed: number;
  force?: 'mesh' | 'plane' | 'pick' | 'lap' | 'atelier';
}

export interface SurfaceChoice {
  kind: SurfaceKind;
  position: Vec3 | null;
  waiting: boolean;
  /** mesh and plane only: the desk chosen (a copy), for placeOnDesk. */
  desk?: SurfaceCandidate;
}

/** Where the board stands on a desk: the site (x, z), its yaw (radians, as SurfaceSystem turns the site) and the board's centre. */
export interface DeskPlacement {
  x: number; z: number; yaw: number;
  centre: { x: number; z: number };
}

/** A desk top is this far below the eyes of someone seated at it (floor and shelves fall outside). */
export const DESK_BELOW_EYES = { min: 0.25, max: 0.85 } as const;
/** Horizontal distance from the head to the desk centre (m). */
export const DESK_REACH = 0.75;
/** Smallest top that takes the board (m). */
export const DESK_MIN = { width: 0.3, depth: 0.2 } as const;
/** A desk whose centre is further round than this from where the player faces (degrees, flat) is behind them. */
export const DESK_MAX_ANGLE = 100;
/** A desk centre closer than this to the head (flat, m) is under the player's hands: in front whichever way they face. */
export const DESK_UNDER_HEAD = 0.15;
/** The board's centre keeps this far in from each edge of the desk (m; at most half the desk). */
export const DESK_INSET = 0.1;
/** On a desk the site goes this far ahead of the eyes, when the board's centre lands on the desk from there. */
export const DESK_FORWARD = 0.5;
/** Seconds to wait for detected meshes and planes before asking the player. */
export const ROOM_WAIT = 1.5;
/** Seconds after which an unanswered pick gives way to the lap tray. */
export const PICK_UNTIL = 9.5;
export const LAP_FORWARD = 0.4;
export const LAP_BELOW_EYES = 0.42;

const inBand = (head: Vec3, y: number) => {
  const below = head.y - y;
  return below >= DESK_BELOW_EYES.min && below <= DESK_BELOW_EYES.max;
};

const flatDistance = (head: Vec3, c: { x: number; z: number }) => Math.hypot(c.x - head.x, c.z - head.z);

/** Can the board stand on this surface? Either way round counts for the size. */
export function isDesk(head: Vec3, c: SurfaceCandidate): boolean {
  const long = Math.max(c.width, c.depth), short = Math.min(c.width, c.depth);
  return c.horizontal && inBand(head, c.y) && flatDistance(head, c) <= DESK_REACH
    && long >= DESK_MIN.width && short >= DESK_MIN.depth;
}

/** Is the desk's centre within DESK_MAX_ANGLE of where the player faces (or right under their head)? */
export function inFront(head: Vec3, fwd: { x: number; z: number }, c: { x: number; z: number }): boolean {
  const dx = c.x - head.x, dz = c.z - head.z, d = Math.hypot(dx, dz);
  if (d < DESK_UNDER_HEAD) return true;
  const cos = (dx * fwd.x + dz * fwd.z) / (d * (Math.hypot(fwd.x, fwd.z) || 1));
  return cos >= Math.cos((DESK_MAX_ANGLE * Math.PI) / 180);
}

/** The nearest valid desk of one source in front of the player, or undefined. */
function nearestDesk(i: SurfaceInput, source: 'mesh' | 'plane'): SurfaceCandidate | undefined {
  let best: SurfaceCandidate | undefined;
  let bestD = Infinity;
  for (const c of i.candidates) {
    if (c.source !== source || !isDesk(i.head, c) || !inFront(i.head, i.fwd, c)) continue;
    const d = flatDistance(i.head, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** The board's centre from its site: half way along the board's depth, towards the player (site +z). */
const BOARD_CENTRE = (BOARD.zMin + BOARD.zMax) / 2;

/**
 * Where the board stands on a desk. From DESK_FORWARD ahead of the eyes, facing where the player faces, if the
 * board's centre then lands inside the desk drawn in by DESK_INSET. Otherwise the centre moves to the nearest point
 * of that inner rectangle and the board turns so that its far end points from the head through the centre: a desk
 * off to one side gets the board on it, square to the player. The desk is taken as axis-aligned (x by z).
 */
export function placeOnDesk(head: Vec3, fwd: { x: number; z: number }, desk: SurfaceCandidate): DeskPlacement {
  const ix = Math.min(DESK_INSET, desk.width / 2), iz = Math.min(DESK_INSET, desk.depth / 2);
  const x0 = desk.x - desk.width / 2 + ix, x1 = desk.x + desk.width / 2 - ix;
  const z0 = desk.z - desk.depth / 2 + iz, z1 = desk.z + desk.depth / 2 - iz;
  const x = head.x + fwd.x * DESK_FORWARD, z = head.z + fwd.z * DESK_FORWARD;
  // Site +z is towards the player (-fwd), so the centre is BOARD_CENTRE back from the site.
  const cx = x - fwd.x * BOARD_CENTRE, cz = z - fwd.z * BOARD_CENTRE;
  if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) return { x, z, yaw: Math.atan2(-fwd.x, -fwd.z), centre: { x: cx, z: cz } };
  const centre = { x: Math.min(x1, Math.max(x0, cx)), z: Math.min(z1, Math.max(z0, cz)) };
  let ax = centre.x - head.x, az = centre.z - head.z;
  const d = Math.hypot(ax, az);
  if (d < 1e-6) { ax = fwd.x; az = fwd.z; } else { ax /= d; az /= d; }
  return { x: centre.x + ax * BOARD_CENTRE, z: centre.z + az * BOARD_CENTRE, yaw: Math.atan2(-ax, -az), centre };
}

export function lapPosition(head: Vec3, fwd: { x: number; z: number }): Vec3 {
  return { x: head.x + fwd.x * LAP_FORWARD, y: head.y - LAP_BELOW_EYES, z: head.z + fwd.z * LAP_FORWARD };
}

const at = (kind: SurfaceKind, p: Vec3 | null): SurfaceChoice => ({ kind, position: p && { x: p.x, y: p.y, z: p.z }, waiting: false });
const onDesk = (d: SurfaceCandidate): SurfaceChoice => ({ ...at(d.source, d), desk: { ...d } });
const wait = (kind: SurfaceKind): SurfaceChoice => ({ kind, position: null, waiting: true });

function pick(i: SurfaceInput): SurfaceChoice {
  return i.picked && inBand(i.head, i.picked.y) ? at('pick', i.picked) : wait('pick');
}

export function chooseSurface(i: SurfaceInput): SurfaceChoice {
  if (!i.inXR) return at('desk', null);
  switch (i.force) {
    case 'lap': return at('lap', lapPosition(i.head, i.fwd));
    case 'atelier': return at('atelier', null);
    case 'pick': return pick(i);
    case 'mesh':
    case 'plane': {
      const d = nearestDesk(i, i.force);
      return d ? onDesk(d) : wait(i.force);
    }
  }
  if (!i.passthrough) return at('atelier', null);
  const desk = nearestDesk(i, 'mesh') ?? nearestDesk(i, 'plane');
  if (desk) return onDesk(desk);
  if (i.elapsed < ROOM_WAIT) return wait(i.hitTest ? 'pick' : 'lap');
  if (i.hitTest && i.elapsed < PICK_UNTIL) return pick(i);
  return at('lap', lapPosition(i.head, i.fwd));
}

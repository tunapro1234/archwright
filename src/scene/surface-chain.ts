// Where the board goes, as a pure decision (no three.js, no WebXR): SurfaceSystem gathers what the
// session offers and calls chooseSurface every frame until the board has a place.
//
// The fallback chain, in order:
//   outside XR (desktop, emulator page)  → desk: the page's own virtual desk
//   ?surface=<kind>                      → that kind (lap placed now, atelier unplaced, pick waits for a pick)
//   opaque VR (no passthrough)           → atelier: a virtual room with a wooden desk
//   a real desk (mesh first, then plane) → on it, if its centre is not behind the player (placeOnDesk; the desk
//                                          is a turned rectangle, deskRect)
//   first 1.5 s                          → wait for the room data to arrive
//   hit-test, up to 9.5 s                → pick: the player pinches a spot on their desk
//   otherwise                            → lap: a tray 40 cm ahead, 42 cm below the eyes

import { BOARD } from './layout.js';

export type Vec3 = { x: number; y: number; z: number };
export type SurfaceKind = 'desk' | 'atelier' | 'mesh' | 'plane' | 'pick' | 'lap';

export interface SurfaceCandidate {
  /** Centre of the top face, world metres. */
  x: number; y: number; z: number;
  /** The top's own size: width along its local x, depth along its local z. */
  width: number; depth: number;
  /** The top's local frame is rotationY(yaw) (radians; 0 or absent: along the world x and z). */
  yaw?: number;
  horizontal: boolean;
  source: 'mesh' | 'plane';
}

/** A desk top seen from above: centre, its own size (width ≥ depth) and the yaw of its width axis (as SurfaceCandidate). */
export interface DeskRect { x: number; z: number; width: number; depth: number; yaw: number }

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
/** Horizontal distance from the head to the nearest point of the desk where the board's centre can land (m; deskReachPoint). */
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
/** Atelier (opaque VR): the virtual desk top sits this far below the eyes, the arch this far ahead. */
export const ATELIER_BELOW_EYES = 0.45;
export const ATELIER_FORWARD = 0.5;

const inBand = (head: Vec3, y: number) => {
  const below = head.y - y;
  return below >= DESK_BELOW_EYES.min && below <= DESK_BELOW_EYES.max;
};

const flatDistance = (head: Vec3, c: { x: number; z: number }) => Math.hypot(c.x - head.x, c.z - head.z);

/**
 * The point of the desk drawn in by DESK_INSET (at most half the desk each way: the rectangle the board's centre may land
 * in) nearest to `p`, worked out in the desk's own frame (its yaw); `inside` when that is `p` itself.
 */
export function deskReachPoint(desk: SurfaceCandidate, p: { x: number; z: number }): { x: number; z: number; inside: boolean } {
  const hw = desk.width / 2 - Math.min(DESK_INSET, desk.width / 2), hd = desk.depth / 2 - Math.min(DESK_INSET, desk.depth / 2);
  const c = Math.cos(desk.yaw ?? 0), s = Math.sin(desk.yaw ?? 0);
  // u along its width, v along its depth.
  const dx = p.x - desk.x, dz = p.z - desk.z, u = c * dx - s * dz, v = s * dx + c * dz;
  if (Math.abs(u) <= hw && Math.abs(v) <= hd) return { x: p.x, z: p.z, inside: true };
  const cu = Math.min(hw, Math.max(-hw, u)), cv = Math.min(hd, Math.max(-hd, v));
  return { x: desk.x + cu * c + cv * s, z: desk.z - cu * s + cv * c, inside: false };
}

/** Can the board stand on this surface? Either way round counts for the size; the reach is to where the board's centre
 *  would land nearest the head, so a deep desk the player sits back from still counts. */
export function isDesk(head: Vec3, c: SurfaceCandidate): boolean {
  const long = Math.max(c.width, c.depth), short = Math.min(c.width, c.depth);
  return c.horizontal && inBand(head, c.y) && flatDistance(head, deskReachPoint(c, head)) <= DESK_REACH
    && long >= DESK_MIN.width && short >= DESK_MIN.depth;
}

/** Is the desk's centre within DESK_MAX_ANGLE of where the player faces (or right under their head)? */
export function inFront(head: Vec3, fwd: { x: number; z: number }, c: { x: number; z: number }): boolean {
  const dx = c.x - head.x, dz = c.z - head.z, d = Math.hypot(dx, dz);
  if (d < DESK_UNDER_HEAD) return true;
  const cos = (dx * fwd.x + dz * fwd.z) / (d * (Math.hypot(fwd.x, fwd.z) || 1));
  return cos >= Math.cos((DESK_MAX_ANGLE * Math.PI) / 180);
}

/** Desks whose landing points are within this much (m) of the nearest one's are as good as tied: of those, the one whose
 *  centre is nearest the way the player faces wins, so a deep desk ahead is not lost to a side table a few cm nearer. */
export const DESK_TIE = 0.1;

/** Angle (radians, flat) between where the player faces and a desk's centre. */
function offAxis(head: Vec3, fwd: { x: number; z: number }, c: { x: number; z: number }): number {
  const dx = c.x - head.x, dz = c.z - head.z;
  if (Math.hypot(dx, dz) < 1e-9) return 0;
  return Math.abs(Math.atan2(dx * fwd.z - dz * fwd.x, dx * fwd.x + dz * fwd.z));
}

/**
 * The valid desk of one source in front of the player to put the board on, or undefined: of the desks whose landing point
 * (deskReachPoint) is within DESK_TIE of the nearest one's, the one whose centre is nearest the way the player faces
 * (then the nearer landing point). Does not depend on the order of the candidates.
 */
function nearestDesk(i: SurfaceInput, source: 'mesh' | 'plane'): SurfaceCandidate | undefined {
  const valid = i.candidates.filter(c => c.source === source && isDesk(i.head, c) && inFront(i.head, i.fwd, c))
    .map(c => ({ c, d: flatDistance(i.head, deskReachPoint(c, i.head)), a: offAxis(i.head, i.fwd, c) }));
  if (!valid.length) return undefined;
  const nearest = Math.min(...valid.map(v => v.d));
  let best = valid[0];
  for (const v of valid) {
    if (v.d > nearest + DESK_TIE) continue;
    if (best.d > nearest + DESK_TIE || v.a < best.a - 1e-9 || (Math.abs(v.a - best.a) <= 1e-9 && v.d < best.d)) best = v;
  }
  return best.c;
}

/** The board's centre from its site: half way along the board's depth, towards the player (site +z). */
const BOARD_CENTRE = (BOARD.zMin + BOARD.zMax) / 2;

/**
 * The smallest-area rectangle around a desk's points seen from above (x, z), from the edges of their convex hull:
 * one side of that rectangle always lies along a hull edge. A real room's furniture is not square to the session's
 * axes, so a desk turned 30° keeps its own 1.2 × 0.6 m, and a narrow shelf turned 45° stays narrow.
 */
export function deskRect(points: readonly { x: number; z: number }[]): DeskRect {
  const h = hull(points);
  let best: DeskRect = { x: h[0]?.x ?? 0, z: h[0]?.z ?? 0, width: 0, depth: 0, yaw: 0 };
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b.x - a.x, ez = b.z - a.z, len = Math.hypot(ex, ez);
    if (len < 1e-9) continue;
    // Width axis along the edge: u = (cos, -sin) in (x, z), so yaw = atan2(-ez, ex); depth axis v = (sin, cos).
    const yaw = Math.atan2(-ez, ex), c = Math.cos(yaw), s = Math.sin(yaw);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of h) {
      const u = c * p.x - s * p.z, v = s * p.x + c * p.z;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area >= bestArea - 1e-12) continue;
    bestArea = area;
    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
    best = { x: um * c + vm * s, z: -um * s + vm * c, width: u1 - u0, depth: v1 - v0, yaw };
  }
  if (best.width < best.depth) {
    // Turn the frame a quarter so the width is the long side: the old depth axis (sin, cos) becomes -u.
    best = { ...best, width: best.depth, depth: best.width, yaw: best.yaw + Math.PI / 2 };
  }
  // Keep the yaw in (-π/2, π/2]: a rectangle is the same turned half a turn.
  if (best.yaw > Math.PI / 2) best.yaw -= Math.PI; else if (best.yaw <= -Math.PI / 2) best.yaw += Math.PI;
  return best;
}

/** Convex hull, counter-clockwise (monotone chain); collinear points dropped. */
function hull(points: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: { x: number; z: number }[] = [], hi: { x: number; z: number }[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}

/**
 * Where the board stands on a desk. From DESK_FORWARD ahead of the eyes, facing where the player faces, if the
 * board's centre then lands inside the desk drawn in by DESK_INSET. Otherwise the centre moves to the nearest point
 * of that inner rectangle and the board turns so that its far end points from the head through the centre: a desk
 * off to one side gets the board on it, square to the player. Both are worked out in the desk's own frame (its yaw),
 * so a desk turned against the room's axes keeps the board inside its real edges.
 */
export function placeOnDesk(head: Vec3, fwd: { x: number; z: number }, desk: SurfaceCandidate): DeskPlacement {
  const x = head.x + fwd.x * DESK_FORWARD, z = head.z + fwd.z * DESK_FORWARD;
  // Site +z is towards the player (-fwd), so the centre is BOARD_CENTRE back from the site.
  const cx = x - fwd.x * BOARD_CENTRE, cz = z - fwd.z * BOARD_CENTRE;
  const near = deskReachPoint(desk, { x: cx, z: cz });
  if (near.inside) return { x, z, yaw: Math.atan2(-fwd.x, -fwd.z), centre: { x: cx, z: cz } };
  // Clamped towards where the player faces, the centre may end up out of reach along a long desk off to the side:
  // then it goes to the point isDesk measured, the nearest the head.
  const reach = flatDistance(head, near) > DESK_REACH ? deskReachPoint(desk, head) : near;
  const centre = { x: reach.x, z: reach.z };
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

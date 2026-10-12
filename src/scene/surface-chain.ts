// Where the board goes, as a pure decision (no three.js, no WebXR): SurfaceSystem gathers what the
// session offers and calls chooseSurface every frame until the board has a place.
//
// The fallback chain, in order:
//   outside XR (desktop, emulator page)  → desk: the page's own virtual desk
//   ?surface=<kind>                      → that kind (lap placed now, atelier unplaced, pick waits for a pick)
//   opaque VR (no passthrough)           → atelier: a virtual room with a wooden desk
//   a real desk (mesh first, then plane) → on it
//   first 1.5 s                          → wait for the room data to arrive
//   hit-test, up to 9.5 s                → pick: the player pinches a spot on their desk
//   otherwise                            → lap: a tray 40 cm ahead, 42 cm below the eyes

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
}

/** A desk top is this far below the eyes of someone seated at it (floor and shelves fall outside). */
export const DESK_BELOW_EYES = { min: 0.25, max: 0.85 } as const;
/** Horizontal distance from the head to the desk centre (m). */
export const DESK_REACH = 0.75;
/** Smallest top that takes the board (m). */
export const DESK_MIN = { width: 0.3, depth: 0.2 } as const;
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

/** The nearest valid desk of one source, or undefined. */
function nearestDesk(i: SurfaceInput, source: 'mesh' | 'plane'): SurfaceCandidate | undefined {
  let best: SurfaceCandidate | undefined;
  let bestD = Infinity;
  for (const c of i.candidates) {
    if (c.source !== source || !isDesk(i.head, c)) continue;
    const d = flatDistance(i.head, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function lapPosition(head: Vec3, fwd: { x: number; z: number }): Vec3 {
  return { x: head.x + fwd.x * LAP_FORWARD, y: head.y - LAP_BELOW_EYES, z: head.z + fwd.z * LAP_FORWARD };
}

const at = (kind: SurfaceKind, p: Vec3 | null): SurfaceChoice => ({ kind, position: p && { x: p.x, y: p.y, z: p.z }, waiting: false });
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
      return d ? at(i.force, d) : wait(i.force);
    }
  }
  if (!i.passthrough) return at('atelier', null);
  const desk = nearestDesk(i, 'mesh') ?? nearestDesk(i, 'plane');
  if (desk) return at(desk.source, desk);
  if (i.elapsed < ROOM_WAIT) return wait(i.hitTest ? 'pick' : 'lap');
  if (i.hitTest && i.elapsed < PICK_UNTIL) return pick(i);
  return at('lap', lapPosition(i.head, i.fwd));
}

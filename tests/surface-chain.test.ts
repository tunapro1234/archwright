import { describe, expect, it } from 'vitest';
import {
  chooseSurface, DESK_FORWARD, DESK_INSET, DESK_MAX_ANGLE, DESK_REACH, deskReachPoint, deskRect, inFront, isDesk, LAP_BELOW_EYES, PICK_UNTIL, placeOnDesk,
  ROOM_WAIT, type DeskPlacement, type SurfaceCandidate, type SurfaceInput,
} from '../src/scene/surface-chain.js';
import { BOARD } from '../src/scene/layout.js';

const head = { x: 0.3, y: 1.15, z: 0.2 };
const top = (o: Partial<SurfaceCandidate> = {}): SurfaceCandidate =>
  ({ x: 0.3, y: 0.72, z: -0.25, width: 1.0, depth: 0.6, horizontal: true, source: 'plane', ...o });
const input = (o: Partial<SurfaceInput> = {}): SurfaceInput =>
  ({ inXR: true, passthrough: true, head, fwd: { x: 0, z: -1 }, candidates: [], hitTest: true, elapsed: 4, ...o });

describe('chooseSurface', () => {
  it('takes a narrow but long top either way round', () => {
    expect(isDesk(head, top({ width: 0.22, depth: 0.5 }))).toBe(true);
    expect(isDesk(head, top({ width: 0.5, depth: 0.18 }))).toBe(false);
  });

  it('measures the desk band from the eyes, not from the floor (local reference space)', () => {
    const low = { x: 0, y: 0.0, z: 0 };
    expect(chooseSurface(input({ head: low, candidates: [top({ x: 0, z: -0.4, y: -0.45 })] })).kind).toBe('plane');
    expect(chooseSurface(input({ head: low, candidates: [top({ x: 0, z: -0.4, y: 0.72 })], hitTest: false })).kind).toBe('lap');
  });

  it('a mesh desk out of reach does not beat a plane desk in reach', () => {
    const c = chooseSurface(input({ candidates: [top(), top({ source: 'mesh', z: -1.2 })] }));
    expect(c.kind).toBe('plane');
  });

  it('forced mesh or plane waits until such a desk shows up, never falls back', () => {
    expect(chooseSurface(input({ force: 'mesh', candidates: [top()], elapsed: 30 }))).toEqual({ kind: 'mesh', position: null, waiting: true });
    expect(chooseSurface(input({ force: 'plane', candidates: [top()] })).kind).toBe('plane');
  });

  it('forced lap and pick still need XR: outside it the page desk wins', () => {
    expect(chooseSurface(input({ inXR: false, force: 'lap' })).kind).toBe('desk');
  });

  it('the pick window closes at PICK_UNTIL, and the room wait at ROOM_WAIT', () => {
    expect(chooseSurface(input({ elapsed: ROOM_WAIT - 0.01 })).waiting).toBe(true);
    expect(chooseSurface(input({ elapsed: PICK_UNTIL - 0.01 })).kind).toBe('pick');
    const lap = chooseSurface(input({ elapsed: PICK_UNTIL }));
    expect(lap.kind).toBe('lap');
    expect(lap.position!.y).toBeCloseTo(head.y - LAP_BELOW_EYES);
  });

  it('a pick that came in late still counts while the window is open', () => {
    const c = chooseSurface(input({ elapsed: 9, picked: { x: 0.2, y: 0.75, z: -0.3 } }));
    expect(c).toEqual({ kind: 'pick', position: { x: 0.2, y: 0.75, z: -0.3 }, waiting: false });
  });

  it('returns fresh position objects (callers may keep them)', () => {
    const picked = { x: 0.2, y: 0.75, z: -0.3 };
    const c = chooseSurface(input({ picked }));
    expect(c.position).not.toBe(picked);
  });
});

describe('placeOnDesk', () => {
  const eyes = { x: 0, y: 1.15, z: 0 };
  const desk = (x: number, z: number, width: number, depth: number): SurfaceCandidate =>
    ({ x, y: 0.75, z, width, depth, horizontal: true, source: 'mesh' });
  const mid = (BOARD.zMin + BOARD.zMax) / 2;
  /** The board's far end (site -z) as a flat unit vector. */
  const far = (r: DeskPlacement) => ({ x: -Math.sin(r.yaw), z: -Math.cos(r.yaw) });
  const deg = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    (Math.acos(Math.min(1, (a.x * b.x + a.z * b.z) / (Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z)))) * 180) / Math.PI;
  /** Inside the desk drawn in by DESK_INSET (or by half the desk, if smaller). */
  const inner = (c: { x: number; z: number }, m: SurfaceCandidate) => {
    const ix = Math.min(DESK_INSET, m.width / 2), iz = Math.min(DESK_INSET, m.depth / 2);
    return c.x >= m.x - m.width / 2 + ix - 1e-9 && c.x <= m.x + m.width / 2 - ix + 1e-9
      && c.z >= m.z - m.depth / 2 + iz - 1e-9 && c.z <= m.z + m.depth / 2 - iz + 1e-9;
  };
  /** The centre is the site moved half the board's depth towards the player. */
  const consistent = (r: DeskPlacement) => {
    expect(r.centre.x).toBeCloseTo(r.x - far(r).x * mid, 9);
    expect(r.centre.z).toBeCloseTo(r.z - far(r).z * mid, 9);
  };

  it('a desk ahead: the site DESK_FORWARD ahead of the eyes and the board facing the same way, as before', () => {
    for (const fwd of [{ x: 0, z: -1 }, { x: Math.SQRT1_2, z: -Math.SQRT1_2 }]) {
      const m = desk(fwd.x * 0.55, fwd.z * 0.55, 1.2, 1.2);
      const r = placeOnDesk(eyes, fwd, m);
      expect(r.x).toBeCloseTo(fwd.x * DESK_FORWARD, 9);
      expect(r.z).toBeCloseTo(fwd.z * DESK_FORWARD, 9);
      expect(r.yaw).toBeCloseTo(Math.atan2(-fwd.x, -fwd.z), 9);
      consistent(r);
    }
  });

  it('a desk to one side: the centre on the desk, the board square to the player', () => {
    const m = desk(-0.1, -0.45, 0.8, 0.5);
    const r = placeOnDesk(eyes, { x: -1, z: 0 }, m);
    consistent(r);
    expect(inner(r.centre, m)).toBe(true);
    expect(deg(far(r), r.centre)).toBeLessThan(1e-6);
  });

  it('the centre goes to the nearest point of the inner rectangle (a side and a corner)', () => {
    const m = desk(0, -0.75, 1.0, 0.4); // near edge z = -0.55
    const edge = placeOnDesk(eyes, { x: 0, z: -1 }, m);
    expect(edge.centre.x).toBeCloseTo(0, 9);
    expect(edge.centre.z).toBeCloseTo(-0.55 - DESK_INSET, 9);
    const corner = placeOnDesk(eyes, { x: 0, z: -1 }, desk(0.6, -0.75, 0.4, 0.4));
    expect(corner.centre.x).toBeCloseTo(0.5, 9);
    expect(corner.centre.z).toBeCloseTo(-0.65, 9);
  });

  it('a 30 x 20 cm desk: the centre on its middle line, never past it', () => {
    const m = desk(0.1, -0.6, 0.3, 0.2);
    const r = placeOnDesk(eyes, { x: 0, z: -1 }, m);
    consistent(r);
    expect(inner(r.centre, m)).toBe(true);
    expect(r.centre.z).toBeCloseTo(-0.6, 9);
  });

  it('a centre right under the head keeps the way the player faces', () => {
    const r = placeOnDesk({ x: 0, y: 1.15, z: -0.4 }, { x: 0, z: -1 }, desk(0, -0.4, 0.2, 0.2));
    expect(r.centre).toEqual({ x: 0, z: -0.4 });
    expect(r.yaw).toBeCloseTo(0, 9);
  });

  it('does not change its inputs', () => {
    const m = desk(-0.1, -0.45, 0.8, 0.5), fwd = { x: -1, z: 0 }, copy = { ...m };
    placeOnDesk(eyes, fwd, m);
    expect(m).toEqual(copy);
    expect(fwd).toEqual({ x: -1, z: 0 });
  });
});

describe('desks behind the player', () => {
  const eyes = { x: 0, y: 1.15, z: 0 };
  const at = (deg: number, d = 0.45) => ({ x: -Math.sin((deg * Math.PI) / 180) * d, z: -Math.cos((deg * Math.PI) / 180) * d });
  const seated = (o: Partial<SurfaceInput> = {}): SurfaceInput =>
    ({ inXR: true, passthrough: true, head: eyes, fwd: { x: 0, z: -1 }, candidates: [], hitTest: true, elapsed: 2, ...o });

  it('a desk up to DESK_MAX_ANGLE round counts, past it not, either side', () => {
    for (const sign of [1, -1]) {
      expect(inFront(eyes, { x: 0, z: -1 }, at(sign * (DESK_MAX_ANGLE - 0.5)))).toBe(true);
      expect(inFront(eyes, { x: 0, z: -1 }, at(sign * (DESK_MAX_ANGLE + 0.5)))).toBe(false);
    }
  });

  it('chooseSurface skips a desk behind for the next in front, or moves down the chain', () => {
    const behind = { ...at(180), y: 0.75, width: 0.8, depth: 0.5, horizontal: true, source: 'mesh' as const };
    const side = { ...at(90), y: 0.75, width: 0.8, depth: 0.5, horizontal: true, source: 'plane' as const };
    expect(chooseSurface(seated({ candidates: [behind] })).kind).toBe('pick');
    expect(chooseSurface(seated({ candidates: [behind], force: 'mesh' })).waiting).toBe(true);
    const c = chooseSurface(seated({ candidates: [behind, side] }));
    expect(c.kind).toBe('plane');
    expect(c.desk).toEqual(side);
    expect(c.desk).not.toBe(side);
  });

  it('a desk centre within 15 cm of the head is in front whichever way the player faces', () => {
    const under = { x: 0, y: 0.75, z: -0.1, width: 0.8, depth: 0.5, horizontal: true, source: 'mesh' as const };
    expect(chooseSurface(seated({ fwd: { x: 0, z: 1 }, candidates: [under] })).kind).toBe('mesh');
  });
});

describe('a desk turned against the room', () => {
  const eyes = { x: 0, y: 1.15, z: 0 };
  const rad = (d: number) => (d * Math.PI) / 180;
  const turned = (x: number, z: number, width: number, depth: number, yawDeg: number, source: 'mesh' | 'plane' = 'mesh'): SurfaceCandidate =>
    ({ x, y: 0.75, z, width, depth, yaw: rad(yawDeg), horizontal: true, source });
  /** Desk frame (u along the width, v along the depth) to world and back, as three.js rotationY(yaw). */
  const world = (m: SurfaceCandidate, u: number, v: number) => {
    const c = Math.cos(m.yaw ?? 0), s = Math.sin(m.yaw ?? 0);
    return { x: m.x + u * c + v * s, z: m.z - u * s + v * c };
  };
  const local = (m: SurfaceCandidate, p: { x: number; z: number }) => {
    const c = Math.cos(m.yaw ?? 0), s = Math.sin(m.yaw ?? 0), dx = p.x - m.x, dz = p.z - m.z;
    return { u: c * dx - s * dz, v: s * dx + c * dz };
  };
  const corners = (m: SurfaceCandidate) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => world(m, (a * m.width) / 2, (b * m.depth) / 2));
  const inner = (m: SurfaceCandidate, p: { x: number; z: number }) => {
    const { u, v } = local(m, p);
    return Math.abs(u) <= m.width / 2 - Math.min(DESK_INSET, m.width / 2) + 1e-9
      && Math.abs(v) <= m.depth / 2 - Math.min(DESK_INSET, m.depth / 2) + 1e-9;
  };
  const facing = (deg: number) => ({ x: -Math.sin(rad(deg)), z: -Math.cos(rad(deg)) });

  it('deskRect finds a turned desk\'s own size, centre and turn from its corners and inner points', () => {
    for (const yd of [0, 30, -30, 45, 90, 120]) {
      const m = turned(0.2, -0.5, 1.2, 0.6, yd);
      const r = deskRect([...corners(m), world(m, 0.3, 0.2), world(m, -0.5, -0.1)]);
      expect(r.width).toBeCloseTo(1.2, 9);
      expect(r.depth).toBeCloseTo(0.6, 9);
      expect(r.x).toBeCloseTo(0.2, 9);
      expect(r.z).toBeCloseTo(-0.5, 9);
      // The same rectangle: the yaw only up to half a turn.
      const d = (((r.yaw - rad(yd)) % Math.PI) + Math.PI) % Math.PI;
      expect(Math.min(d, Math.PI - d)).toBeLessThan(1e-9);
    }
  });

  it('deskRect puts the long side in the width, and survives too few points', () => {
    const r = deskRect([{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 0.2, z: 0.9 }, { x: 0, z: 0.9 }]);
    expect(r.width).toBeCloseTo(0.9, 9);
    expect(r.depth).toBeCloseTo(0.2, 9);
    expect(deskRect([]).width).toBe(0);
    expect(deskRect([{ x: 1, z: 2 }, { x: 1, z: 3 }]).depth).toBeCloseTo(0, 9);
  });

  it('a 0.6 x 0.15 shelf turned 45 degrees stays narrow and is not a desk', () => {
    const shelf = turned(0, -0.5, 0.6, 0.15, 45, 'plane');
    const r = deskRect(corners(shelf));
    const c = { ...shelf, ...r };
    expect(Math.min(r.width, r.depth)).toBeCloseTo(0.15, 9);
    expect(isDesk(eyes, c)).toBe(false);
    expect(chooseSurface({ inXR: true, passthrough: true, head: eyes, fwd: { x: 0, z: -1 }, candidates: [c], hitTest: true, elapsed: 3 }).kind).not.toBe('plane');
  });

  it('on a desk turned 30 or 45 degrees the board\'s centre stays inside the desk for every way the player faces', () => {
    for (const yd of [30, -30, 45, -45]) {
      const m = turned(0, -0.5, 1.2, 0.6, yd);
      for (let t = -100; t <= 100; t += 2) {
        const r = placeOnDesk(eyes, facing(t), m);
        expect(inner(m, r.centre), `desk ${yd}, facing ${t}: ${JSON.stringify(local(m, r.centre))}`).toBe(true);
      }
    }
  });

  it('a clamped centre on a turned desk: the board\'s far end points from the head through it', () => {
    const m = turned(-0.3, -0.4, 1.2, 0.6, 30);
    const r = placeOnDesk(eyes, facing(-60), m);
    expect(inner(m, r.centre)).toBe(true);
    const far = { x: -Math.sin(r.yaw), z: -Math.cos(r.yaw) }, d = Math.hypot(r.centre.x, r.centre.z);
    expect(far.x).toBeCloseTo(r.centre.x / d, 9);
    expect(far.z).toBeCloseTo(r.centre.z / d, 9);
  });

  it('yaw 0 is the axis-aligned desk; 90 degrees with width and depth swapped is the same desk', () => {
    for (let t = -90; t <= 90; t += 10) {
      const plain = placeOnDesk(eyes, facing(t), { x: 0.1, y: 0.75, z: -0.5, width: 1.2, depth: 0.6, horizontal: true, source: 'mesh' });
      const zero = placeOnDesk(eyes, facing(t), turned(0.1, -0.5, 1.2, 0.6, 0));
      const swapped = placeOnDesk(eyes, facing(t), turned(0.1, -0.5, 0.6, 1.2, 90));
      for (const r of [zero, swapped]) {
        expect(r.centre.x).toBeCloseTo(plain.centre.x, 9);
        expect(r.centre.z).toBeCloseTo(plain.centre.z, 9);
        expect(r.yaw).toBeCloseTo(plain.yaw, 9);
      }
    }
  });
});

// The reach is measured to the nearest point where the board's centre can land (the desk drawn in by DESK_INSET), not to
// the desk's centre: a player seated 45 cm back from a deep desk still gets the board on it.
describe('desk reach', () => {
  const eyes = { x: 0, y: 1.15, z: 0 };
  const facing = (o: Partial<SurfaceInput>): SurfaceInput =>
    ({ inXR: true, passthrough: true, head: eyes, fwd: { x: 0, z: -1 }, candidates: [], hitTest: true, elapsed: 3, ...o });
  // A 1.60 × 0.75 m desk whose near edge is 45 cm ahead: its centre 0.825 m away, its inner rectangle 0.55 m.
  const deep: SurfaceCandidate = { x: 0, y: 0.75, z: -(0.45 + 0.375), width: 1.6, depth: 0.75, horizontal: true, source: 'plane' };

  it('a deep desk with its centre 0.83 m away is a desk, and the board lands on it', () => {
    expect(Math.hypot(deep.x, deep.z)).toBeGreaterThan(DESK_REACH);
    const near = deskReachPoint(deep, eyes);
    expect(near.inside).toBe(false);
    expect(Math.hypot(near.x, near.z)).toBeCloseTo(0.45 + DESK_INSET, 9);
    expect(isDesk(eyes, deep)).toBe(true);
    const c = chooseSurface(facing({ candidates: [deep] }));
    expect(c.kind).toBe('plane');
    const p = placeOnDesk(eyes, { x: 0, z: -1 }, c.desk!);
    expect(deskReachPoint(deep, p.centre).inside).toBe(true);
  });

  it('turned 30°, the same desk is still in reach', () => {
    expect(isDesk(eyes, { ...deep, yaw: Math.PI / 6 })).toBe(true);
  });

  it('a desk whose nearest landing point is 0.80 m away is not a desk', () => {
    const far: SurfaceCandidate = { ...deep, z: -(0.8 - DESK_INSET + 0.375) };
    const near = deskReachPoint(far, eyes);
    expect(Math.hypot(near.x, near.z)).toBeCloseTo(0.8, 9);
    expect(isDesk(eyes, far)).toBe(false);
    expect(chooseSurface(facing({ candidates: [far] })).kind).not.toBe('plane');
  });

  it('the deep desk behind the player is in reach but still not chosen (DESK_MAX_ANGLE is to its centre)', () => {
    const behind = { ...deep, z: -deep.z };
    expect(isDesk(eyes, behind)).toBe(true);
    expect(inFront(eyes, { x: 0, z: -1 }, behind)).toBe(false);
    expect(chooseSurface(facing({ candidates: [behind] })).kind).not.toBe('plane');
  });

  it('a desk small enough that its inner rectangle is its centre: the reach is to the centre, as before', () => {
    const small: SurfaceCandidate = { x: 0, y: 0.75, z: -0.74, width: 0.2, depth: 0.2, horizontal: true, source: 'plane' };
    const near = deskReachPoint(small, eyes);
    expect(near.x).toBeCloseTo(small.x, 12);
    expect(near.z).toBeCloseTo(small.z, 12);
  });
});

describe('desk reach: where the board lands and which desk wins', () => {
  const eyes = { x: 0, y: 1.15, z: 0 };
  const ahead = { x: 0, z: -1 };
  const facing = (candidates: SurfaceCandidate[]): SurfaceInput =>
    ({ inXR: true, passthrough: true, head: eyes, fwd: ahead, candidates, hitTest: true, elapsed: 2 });

  it('a long desk off to the side: the board\'s centre is never further than DESK_REACH from the head', () => {
    const side: SurfaceCandidate = { x: -0.95, y: 0.75, z: -0.3, width: 0.6, depth: 2.0, yaw: 0, horizontal: true, source: 'mesh' };
    const c = chooseSurface(facing([side]));
    expect(c.kind).toBe('mesh');
    const p = placeOnDesk(eyes, ahead, c.desk!);
    expect(Math.hypot(p.centre.x, p.centre.z)).toBeLessThanOrEqual(DESK_REACH + 1e-9);
    expect(deskReachPoint(side, p.centre).inside).toBe(true);
    // Facing the board from the head, as on any clamped desk.
    const toCentre = Math.atan2(-(p.centre.x - eyes.x), -(p.centre.z - eyes.z));
    expect(Math.abs(p.yaw - toCentre)).toBeLessThan(1e-9);
  });

  for (const deg of [0, 30, 60, 90, -45]) {
    it(`any desk the chain takes, facing ${deg}°: the board's centre is within DESK_REACH`, () => {
      const r = (deg * Math.PI) / 180, fwd = { x: -Math.sin(r), z: -Math.cos(r) };
      for (const desk of [
        { x: -0.95, y: 0.75, z: -0.3, width: 0.6, depth: 2.0, yaw: 0, horizontal: true, source: 'mesh' as const },
        { x: 0.6, y: 0.75, z: -0.6, width: 1.8, depth: 0.7, yaw: 0.5, horizontal: true, source: 'plane' as const },
      ]) {
        const c = chooseSurface({ ...facing([desk]), fwd });
        if (!c.desk) continue;
        const p = placeOnDesk(eyes, fwd, c.desk);
        expect(Math.hypot(p.centre.x, p.centre.z)).toBeLessThanOrEqual(DESK_REACH + 1e-9);
      }
    });
  }
});

// The emulated headset's pose, as pure maths (no IWER, no three.js), for ?emulator=1&head=<yaw>[,<eye height>] and
// for aiming an emulated controller or hand at a point, and for ?seat=table: the tables of a synthetic room and a seat at
// the nearest one. Quaternions are [x, y, z, w]; a pose looks down its -z.

import { deskRect } from '../scene/surface-chain.js';

export type Quat = [number, number, number, number];

/** A seated player: eyes 1.15 m above the floor (a 75 cm desk 40 cm below them), 5 cm behind the origin. */
export const EYE_Y = 1.15;
export const HEAD_Z = 0.05;

/**
 * ?head=<yaw>[,<eye height>]: the yaw in degrees (positive turns left, seen from above: anticlockwise) and the eye
 * height in metres. Anything missing or not a finite number keeps the default (0°, EYE_Y).
 */
export function parseHead(param: string | null): { yaw: number; eyeY: number } {
  const [a, b] = (param ?? '').split(',').map(s => (s.trim() === '' ? NaN : Number(s)));
  return { yaw: Number.isFinite(a) ? a : 0, eyeY: Number.isFinite(b) && b > 0 ? b : EYE_Y };
}

/** A turn of `deg` degrees about the vertical (positive turns -z towards -x: left). */
export function yawQuat(deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** The way a pose with this rotation faces, flattened, as a yaw in degrees in (-180, 180] (0 = -z, positive = left). */
export function yawOf(q: Quat): number {
  const [x, y, z, w] = q;
  // -z rotated by q, x and z components only.
  const fx = -2 * (x * z + w * y), fz = -(1 - 2 * (x * x + y * y));
  return (Math.atan2(-fx, -fz) * 180) / Math.PI;
}

/** The rotation (yaw then pitch, no roll) whose -z points from `from` to `to`; null when they coincide. */
export function aimQuat(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): Quat | null {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) return null;
  const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy / d)));
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** A table top seen from above, as surface-chain.ts has a desk: centre, top height, its own size and the yaw (radians) of its
 *  width axis; local (u, v) → world x = cx + u·cos + v·sin, z = cz − u·sin + v·cos. */
export interface Table { cx: number; cz: number; y: number; width: number; depth: number; yaw: number }

/** ?seat=table: a chair this far out from the table's long edge (m). */
export const SEAT_BACK = 0.45;

/**
 * Where to sit at the table nearest `from` (flat distance to its centre): SEAT_BACK out from the middle of its long edge
 * on `from`'s side, facing the table's centre (yaw in degrees as ?head= has it: 0 = -z, positive = left). Null without tables.
 */
export function seatAtTable(tables: readonly Table[], from: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
  let t: Table | undefined;
  for (const c of tables) if (!t || Math.hypot(c.cx - from.x, c.cz - from.z) < Math.hypot(t.cx - from.x, t.cz - from.z)) t = c;
  if (!t) return null;
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  // The long edges run along the longer local axis; step out along the other one, towards `from`.
  const alongU = t.width >= t.depth;
  const ax = alongU ? { x: s, z: c } : { x: c, z: -s };  // world direction of the short local axis (v, or u)
  const half = (alongU ? t.depth : t.width) / 2;
  const side = (from.x - t.cx) * ax.x + (from.z - t.cz) * ax.z < 0 ? -1 : 1;
  const x = t.cx + ax.x * side * (half + SEAT_BACK), z = t.cz + ax.z * side * (half + SEAT_BACK);
  return { x, z, yaw: (Math.atan2(-(t.cx - x), -(t.cz - z)) * 180) / Math.PI };
}

type P3 = { x: number; y: number; z: number };
type Q4 = { x: number; y: number; z: number; w: number };

/** `v` turned by the unit quaternion `q`. */
function turn(q: Q4, v: P3): P3 {
  // v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * The tables of a synthetic room file (the spatialEntities labelled TABLE), in the world frame, as the room module
 * builds them: a bounded2D entity is a plane whose polygon lies in its local x-z (offset/extent along x and z), a
 * bounded3D entity a box (offset/extent along x, y, z), both placed by their locatable pose. The top is the plane's
 * height or the box's highest corner; the size and yaw are the smallest rectangle around the corners seen from above.
 * A table given both ways counts twice, in the same place. Anything malformed is skipped.
 */
export function roomTables(room: unknown): Table[] {
  const out: Table[] = [];
  const list = (room as { spatialEntities?: unknown })?.spatialEntities;
  if (!Array.isArray(list)) return out;
  for (const e of list as Record<string, any>[]) {
    if (e?.semanticLabel_META !== 'TABLE' || !e.locatable_META) continue;
    const { position: p, orientation: q } = e.locatable_META as { position?: P3; orientation?: Q4 };
    if (!p || !q) continue;
    const local: P3[] = [];
    const b2 = e.bounded2D_META, b3 = e.bounded3D_META;
    if (b2?.offset && b2?.extent) {
      for (const u of [0, 1]) for (const v of [0, 1])
        local.push({ x: b2.offset.x + u * b2.extent.width, y: 0, z: b2.offset.y + v * b2.extent.height });
    } else if (b3?.offset && b3?.extent) {
      for (const u of [0, 1]) for (const w of [0, 1]) for (const v of [0, 1])
        local.push({ x: b3.offset.x + u * b3.extent.width, y: b3.offset.y + w * b3.extent.height, z: b3.offset.z + v * b3.extent.depth });
    } else continue;
    const world = local.map(c => { const r = turn(q, c); return { x: p.x + r.x, y: p.y + r.y, z: p.z + r.z }; });
    if (!world.every(c => Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z))) continue;
    const r = deskRect(world);
    out.push({ cx: r.x, cz: r.z, y: Math.max(...world.map(c => c.y)), width: r.width, depth: r.depth, yaw: r.yaw });
  }
  return out;
}

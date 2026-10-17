// The emulated headset's pose, as pure maths (no IWER, no three.js), for ?emulator=1&head=<yaw>[,<eye height>] and
// for aiming an emulated controller or hand at a point. Quaternions are [x, y, z, w]; a pose looks down its -z.

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

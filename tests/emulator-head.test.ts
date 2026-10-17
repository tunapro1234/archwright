import { describe, expect, it } from 'vitest';
import { aimQuat, EYE_Y, parseHead, yawOf, yawQuat, type Quat } from '../src/emulator/head.js';

/** -z rotated by q. */
const forward = ([x, y, z, w]: Quat) => ({
  x: -2 * (x * z + w * y),
  y: -2 * (y * z - w * x),
  z: -(1 - 2 * (x * x + y * y)),
});

describe('?head=', () => {
  it('reads the yaw and the eye height, keeping the defaults for what is missing or not a number', () => {
    expect(parseHead('90')).toEqual({ yaw: 90, eyeY: EYE_Y });
    expect(parseHead('-45,1.6')).toEqual({ yaw: -45, eyeY: 1.6 });
    expect(parseHead(null)).toEqual({ yaw: 0, eyeY: EYE_Y });
    expect(parseHead('left,tall')).toEqual({ yaw: 0, eyeY: EYE_Y });
    expect(parseHead(',1.3')).toEqual({ yaw: 0, eyeY: 1.3 });
    expect(parseHead('180,-1')).toEqual({ yaw: 180, eyeY: EYE_Y });
  });

  it('a positive yaw turns left: 90 faces -x, and yawOf reads it back', () => {
    const f = forward(yawQuat(90));
    expect(f.x).toBeCloseTo(-1, 9);
    expect(f.z).toBeCloseTo(0, 9);
    for (const deg of [0, 45, 90, 135, -90, 179]) expect(yawOf(yawQuat(deg))).toBeCloseTo(deg, 9);
    expect(Math.abs(yawOf(yawQuat(270)))).toBeCloseTo(90, 9);
    expect(yawOf(yawQuat(270))).toBeLessThan(0);
  });
});

describe('aimQuat', () => {
  it("points the pose's -z at the target, with no roll", () => {
    const from = { x: 0.25, y: 1.5, z: -0.4 };
    for (const to of [{ x: 0, y: 0.75, z: -0.6 }, { x: 0.25, y: 1.5, z: -1.4 }, { x: -1, y: 2, z: 0.3 }]) {
      const q = aimQuat(from, to)!;
      const f = forward(q), d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      expect(f.x).toBeCloseTo((to.x - from.x) / d, 9);
      expect(f.y).toBeCloseTo((to.y - from.y) / d, 9);
      expect(f.z).toBeCloseTo((to.z - from.z) / d, 9);
      // No roll: the pose's +x stays level.
      const [x, y, z, w] = q;
      expect(2 * (x * y + w * z)).toBeCloseTo(0, 9);
    }
    expect(aimQuat(from, from)).toBeNull();
  });
});

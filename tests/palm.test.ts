// Palm up (src/game/palm.ts) on the joints of IWER's own hand pose, so the sign is checked against Meta's data layout
// and not against a triangle made up to fit: node_modules/iwer/lib/device/configs/hand/relaxed.js, the position column
// [12..14] of each joint's offsetMatrix (the hand's own frame: fingers along -z). IWER's pose data is a LEFT hand; the
// right hand is its mirror, mirrorMatrixToRight (node_modules/iwer/lib/device/XRHandInput.js:58-65, applied at :111),
// whose multiplier flips the sign of the position's x. IWER's pose itself is palm down: turned half a turn about the
// forearm (z) it is palm up, a quarter turn leaves it on its side.
import { describe, expect, it } from 'vitest';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import { isPalmUp, PALM_UP, palmUpness } from '../src/game/palm.js';
import type { Side } from '../src/game/arch-state.js';

type P = { x: number; y: number; z: number };
type Joint = 'wrist' | 'index-finger-metacarpal' | 'pinky-finger-metacarpal' | 'middle-finger-tip' | 'thumb-tip';

/** A joint's position in IWER's hand frame, mirrored for the right hand as XRHandInput does. */
function joint(side: Side, name: Joint): P {
  const m = (relaxedHandPose.jointTransforms as Record<string, { offsetMatrix: number[] }>)[name].offsetMatrix;
  return { x: side === 'right' ? -m[12] : m[12], y: m[13], z: m[14] };
}

/** Turned `deg` about the forearm (the hand frame's z), then turned `yaw` about y and moved, as a hand in a room. */
function placed(p: P, deg: number, yaw = 0, at: P = { x: 0, y: 0, z: 0 }): P {
  const a = (deg * Math.PI) / 180, b = (yaw * Math.PI) / 180;
  const x = p.x * Math.cos(a) - p.y * Math.sin(a), y = p.x * Math.sin(a) + p.y * Math.cos(a);
  return { x: at.x + x * Math.cos(b) + p.z * Math.sin(b), y: at.y + y, z: at.z - x * Math.sin(b) + p.z * Math.cos(b) };
}

const palm = (side: Side, deg: number, yaw?: number, at?: P) =>
  (['wrist', 'index-finger-metacarpal', 'pinky-finger-metacarpal'] as const).map(j => placed(joint(side, j), deg, yaw, at)) as [P, P, P];

describe('palm up, on IWER\'s hand pose', () => {
  it('PALM_UP is 0.6', () => expect(PALM_UP).toBe(0.6));

  for (const side of ['left', 'right'] as const) {
    it(`${side}: IWER's pose is a palm-down hand (fingers forward, thumb ${side === 'left' ? 'right' : 'left'})`, () => {
      // A hand laid palm down on a table: a left thumb lies to the right of its little finger, a right thumb to the left.
      const wrist = joint(side, 'wrist'), tip = joint(side, 'middle-finger-tip');
      const thumb = joint(side, 'thumb-tip'), pinky = joint(side, 'pinky-finger-metacarpal');
      expect(tip.z).toBeLessThan(wrist.z - 0.1);
      if (side === 'left') expect(thumb.x).toBeGreaterThan(pinky.x + 0.05);
      else expect(thumb.x).toBeLessThan(pinky.x - 0.05);
      expect(palmUpness(...palm(side, 0), side)).toBeLessThan(-0.9);
    });

    it(`${side}: as posed, palm down; half a turn about the forearm, up; a quarter turn, on its side; 30° short of up, up`, () => {
      expect(isPalmUp(...palm(side, 0), side)).toBe(false);
      expect(isPalmUp(...palm(side, 180), side)).toBe(true);
      expect(palmUpness(...palm(side, 180), side)).toBeGreaterThan(0.9);
      expect(isPalmUp(...palm(side, 90), side)).toBe(false);
      expect(isPalmUp(...palm(side, -90), side)).toBe(false);
      expect(Math.abs(palmUpness(...palm(side, 90), side))).toBeLessThan(0.2);
      expect(isPalmUp(...palm(side, 150), side)).toBe(true);
      expect(isPalmUp(...palm(side, -150), side)).toBe(true);
    });

    it(`${side}: which way the player faces and where the hand is do not matter`, () => {
      for (const yaw of [-120, -35, 70, 180]) {
        const at = { x: 0.3, y: 0.9, z: -0.4 };
        for (const deg of [0, 90, 150, 180]) {
          expect(palmUpness(...palm(side, deg, yaw, at), side)).toBeCloseTo(palmUpness(...palm(side, deg), side), 9);
        }
      }
    });
  }

  it('the other hand\'s side reads a palm the wrong way round', () => {
    // The left hand's joints read as a right hand give the opposite sign: the side matters.
    expect(palmUpness(...palm('left', 180), 'right')).toBeLessThan(-0.9);
  });

  it('three joints on one line (or on one point): 0, not up', () => {
    const o = { x: 0, y: 0, z: 0 };
    expect(palmUpness(o, o, o, 'right')).toBe(0);
    expect(palmUpness(o, { x: 0, y: 0, z: -0.05 }, { x: 0, y: 0, z: -0.1 }, 'left')).toBe(0);
    expect(isPalmUp(o, o, o, 'left')).toBe(false);
  });
});

// __archwright.emulator.look and .reach (src/emulator/emulator.ts) on a stand-in for IWER's device, with the player rig
// moved and turned so the emulator's space and the world differ: the headset ends up looking at the world point, and a
// reached input's point (its offset from the input, as ReachSystem measures it) lands on the world point. ReachSystem
// itself runs on stubs for IWER's frame and HandSystem: the hand's pinch point sits a fixed way off the hand.
import { describe, expect, it } from 'vitest';
import { Object3D, Quaternion, Vector3, type World } from '@iwsdk/core';
import type { XRDevice } from 'iwer';
import { relaxedHandPose } from 'iwer/lib/device/configs/hand/relaxed.js';
import { emulatorHook, ReachSystem } from '../src/emulator/emulator.js';
import { isPalmUp } from '../src/game/palm.js';

function setup(mode: 'hand' | 'controller') {
  const input = () => ({ position: new Vector3(0.25, 1.5, -0.4), quaternion: new Quaternion() });
  const device = {
    position: new Vector3(0, 1.15, 0.05), quaternion: new Quaternion(), primaryInputMode: mode,
    hands: { left: input(), right: input() }, controllers: { left: input(), right: input() },
  };
  const player = new Object3D();
  player.position.set(0.2, 0, -0.1);
  player.rotation.y = Math.PI / 6;
  player.updateMatrixWorld();
  const world = { player, globals: {} as Record<string, unknown> };
  const hook = emulatorHook(device as unknown as XRDevice, world as unknown as World);
  return { device, player, world, hook };
}

/** IWER's frame and HandSystem, stubbed: each side's point is its current input's world position plus a fixed offset
 *  (a hand's pinch point, a controller's grip); then ReachSystem.update as the game runs it, right after. */
function frames(s: ReturnType<typeof setup>) {
  const { device, player, world } = s;
  const off = { hand: new Vector3(0.02, -0.035, -0.07), controller: new Vector3(0, -0.02, 0.04) };
  const hands = {
    left: { tracked: false, point: new Vector3() },
    right: { tracked: true, point: new Vector3() },
  };
  world.globals.hands = hands;
  world.globals.emulator = device;
  const sys = Object.assign(Object.create(ReachSystem.prototype), { world, player, v: new Vector3() }) as ReachSystem;
  return () => {
    const mode = device.primaryInputMode as 'hand' | 'controller';
    const i = mode === 'hand' ? device.hands.right : device.controllers.right;
    hands.right.point.copy(i.position).applyMatrix4(player.matrixWorld).add(off[mode]);
    sys.update(0, 0);
  };
}

describe('emulator.look', () => {
  it('turns the headset where it stands so its -z points at the world point', () => {
    const { device, player, hook } = setup('controller');
    const eye = device.position.clone().applyMatrix4(player.matrixWorld);
    for (const at of [{ x: 0.1, y: 0.8, z: -0.5 }, { x: -0.4, y: 1.3, z: 0.2 }, { x: 0.3, y: 1.15, z: -1 }]) {
      hook.look(at);
      expect(device.position.toArray()).toEqual([0, 1.15, 0.05]);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(device.quaternion).applyQuaternion(player.quaternion);
      const want = new Vector3(at.x, at.y, at.z).sub(eye).normalize();
      expect(fwd.distanceTo(want)).toBeLessThan(1e-9);
    }
  });
});

describe('emulator.reach', () => {
  for (const mode of ['hand', 'controller'] as const) {
    it(`${mode}: puts the point the game takes the input by on the world point, and keeps the target`, () => {
      const { device, player, world, hook } = setup(mode);
      const reach = world.globals.reach as { at: Record<string, Vector3 | null>; offset: Record<string, Vector3 | null> };
      const at = { x: 0.05, y: 0.8, z: -0.45 };
      const input = mode === 'hand' ? device.hands.right : device.controllers.right;
      // Not measured yet (no frame with the input tracked): only the target is kept, for ReachSystem.
      const before = input.position.clone();
      hook.reach('right', at);
      expect(input.position.toArray()).toEqual(before.toArray());
      expect(reach.at.right!.toArray()).toEqual([at.x, at.y, at.z]);
      // Measured: the pinch point (or grip) lies this far from the input in the world.
      const offset = new Vector3(0.01, -0.03, -0.06);
      reach.offset.right = offset;
      hook.reach('right', at);
      const point = input.position.clone().applyMatrix4(player.matrixWorld).add(offset);
      expect(point.distanceTo(new Vector3(at.x, at.y, at.z))).toBeLessThan(1e-9);
      expect(reach.at.left).toBeNull();
    });
  }
});

describe('emulator.input and emulator.point', () => {
  it('input switches IWER between controllers and hands, and point is the game\'s point for that side (null untracked)', () => {
    const s = setup('controller');
    const frame = frames(s);
    frame();
    const hands = s.world.globals.hands as Record<'left' | 'right', { point: Vector3 }>;
    expect(s.hook.point('right')).toEqual({ x: hands.right.point.x, y: hands.right.point.y, z: hands.right.point.z });
    expect(s.hook.point('left')).toBeNull();
    s.hook.input('hand');
    expect(s.device.primaryInputMode).toBe('hand');
    s.hook.input('controller');
    expect(s.device.primaryInputMode).toBe('controller');
  });

  for (const [from, to] of [['controller', 'hand'], ['hand', 'controller']] as const) {
    it(`reach after switching ${from} → ${to}: ReachSystem measures the new input's offset, and the next frame's point is on the target`, () => {
      const s = setup(from);
      const frame = frames(s);
      const reach = s.world.globals.reach as { offset: Record<'left' | 'right', Vector3 | null> };
      frame(); // the old input's offset is measured
      expect(reach.offset.right).not.toBeNull();
      s.hook.input(to);
      expect(reach.offset.right).toBeNull(); // it does not hold for the other input
      const at = { x: -0.08, y: 0.79, z: -0.42 };
      s.hook.reach('right', at);
      frame(); // measured on this input, then moved so its point lands on `at`
      frame(); // the frame after: the game's point is there
      const p = s.hook.point('right')!;
      expect(Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z)).toBeLessThan(0.005);
      expect(Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z)).toBeLessThan(1e-9);
      // It stays there frame after frame.
      for (let k = 0; k < 3; k++) frame();
      const q = s.hook.point('right')!;
      expect(Math.hypot(q.x - at.x, q.y - at.y, q.z - at.z)).toBeLessThan(1e-9);
    });
  }
});

describe('emulator.palm', () => {
  /** IWER's joints on that hand (its pose's offsets, mirrored for the right hand), in the world through the rig. */
  function palmUpInWorld(s: ReturnType<typeof setup>, side: 'left' | 'right'): boolean {
    const i = s.device.hands[side];
    const [w, a, b] = (['wrist', 'index-finger-metacarpal', 'pinky-finger-metacarpal'] as const).map(j => {
      const m = (relaxedHandPose.jointTransforms as Record<string, { offsetMatrix: number[] }>)[j].offsetMatrix;
      return new Vector3(side === 'right' ? -m[12] : m[12], m[13], m[14])
        .applyQuaternion(i.quaternion).add(i.position).applyMatrix4(s.player.matrixWorld);
    });
    return isPalmUp(w, a, b, side);
  }

  for (const side of ['left', 'right'] as const) {
    it(`${side}: turns the hand palm up and back down where it stands, aimed or not; asking again changes nothing`, () => {
      const s = setup('hand');
      const i = s.device.hands[side];
      // Aimed forward, a little down, aside and up (a hand pointing steeply down has no palm up or down to give).
      for (const at of [null, { x: 0.1, y: 1.3, z: -0.9 }, { x: -0.6, y: 1.5, z: -0.7 }, { x: 0.3, y: 1.7, z: -0.9 }]) {
        if (at) s.hook.aim(side, at);
        const before = i.position.toArray(), aimed = i.quaternion.clone();
        expect(palmUpInWorld(s, side)).toBe(false);
        s.hook.palm(side, 'down');
        expect(i.quaternion.angleTo(aimed)).toBeLessThan(1e-6); // angleTo is an acos: ~3e-8 at best in float
        s.hook.palm(side, 'up');
        expect(palmUpInWorld(s, side)).toBe(true);
        expect(i.position.toArray()).toEqual(before);
        // Half a turn about its own z: the forearm (its -z) still points where it was aimed.
        const fwd = new Vector3(0, 0, -1);
        expect(fwd.clone().applyQuaternion(i.quaternion).distanceTo(fwd.clone().applyQuaternion(aimed))).toBeLessThan(1e-9);
        const up = i.quaternion.clone();
        s.hook.palm(side, 'up');
        expect(i.quaternion.angleTo(up)).toBeLessThan(1e-6);
        s.hook.palm(side, 'down');
        expect(palmUpInWorld(s, side)).toBe(false);
        expect(i.quaternion.angleTo(aimed)).toBeLessThan(1e-6);
      }
    });
  }

  it('with controllers it does nothing', () => {
    const s = setup('controller');
    s.hook.palm('right', 'up');
    expect(s.device.controllers.right.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(s.device.hands.right.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });
});

describe('emulator.end', () => {
  it('ends the running session, and with none does nothing', async () => {
    const { device } = setup('controller');
    let session: { end: () => Promise<void> } | null = null, ended = 0;
    const world = { player: new Object3D(), globals: {}, renderer: { xr: { getSession: () => session } } };
    const hook = emulatorHook(device as unknown as XRDevice, world as unknown as World);
    hook.end();
    session = { end: async () => { ended++; } };
    hook.end();
    await Promise.resolve();
    expect(ended).toBe(1);
  });
});

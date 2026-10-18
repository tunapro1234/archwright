// __archwright.emulator.look and .reach (src/emulator/emulator.ts) on a stand-in for IWER's device, with the player rig
// moved and turned so the emulator's space and the world differ: the headset ends up looking at the world point, and a
// reached input's point (its offset from the input, as ReachSystem measures it) lands on the world point. ReachSystem
// itself runs on stubs for IWER's frame and HandSystem: the hand's pinch point sits a fixed way off the hand.
import { describe, expect, it } from 'vitest';
import { Object3D, Quaternion, Vector3, type World } from '@iwsdk/core';
import type { XRDevice } from 'iwer';
import { emulatorHook, ReachSystem } from '../src/emulator/emulator.js';

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

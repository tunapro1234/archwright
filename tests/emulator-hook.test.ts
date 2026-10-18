// __archwright.emulator.look and .reach (src/emulator/emulator.ts) on a stand-in for IWER's device, with the player rig
// moved and turned so the emulator's space and the world differ: the headset ends up looking at the world point, and a
// reached input's point (its offset from the input, as ReachSystem measures it) lands on the world point.
import { describe, expect, it } from 'vitest';
import { Object3D, Quaternion, Vector3, type World } from '@iwsdk/core';
import type { XRDevice } from 'iwer';
import { emulatorHook } from '../src/emulator/emulator.js';

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

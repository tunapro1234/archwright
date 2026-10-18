// The hover mark and the palm-up hand (GrabSnapSystem.hover, src/systems/grab-snap.ts): a hand with its palm up starts
// no game pinch (src/systems/hands.ts), so it marks no stone either; turned back down it marks the stone again, and the
// other hand still marks its own. GrabSnapSystem runs on stand-ins for ArchRuntime (two tray stones) and HandState.
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { GrabSnapSystem } from '../src/systems/grab-snap.js';
import type { HandState } from '../src/systems/hands.js';
import type { ArchRuntime, StoneView } from '../src/game/runtime.js';
import type { Side } from '../src/game/arch-state.js';

function setup() {
  const site = new Object3D();
  site.position.set(0.1, 0.75, -0.5);
  site.updateMatrixWorld();
  const stone = (id: string, x: number) => ({ def: { id }, mode: 'tray', pose: { x, y: 0.02, z: 0.1, angle: 0, tilt: 0 } });
  const stones = [stone('A', -0.06), stone('B', 0.06)];
  const arch = {
    shown: true, site, stones, state: { phase: 'building', placed: [] },
    stoneById: (id: string) => stones.find(s => s.def.id === id),
  } as unknown as ArchRuntime;
  const hand = (): HandState => ({
    tracked: true, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(), lostFor: 0, palmUp: false,
  });
  const hands: Record<Side, HandState> = { left: hand(), right: hand() };
  hands.left.tracked = false;
  const sys = Object.create(GrabSnapSystem.prototype) as GrabSnapSystem;
  Object.assign(sys, {
    held: { left: undefined, right: undefined }, local: new Vector3(), p: new Vector3(), candidates: [], pool: [],
  });
  /** A hand's pinch point 1 cm above a stone, in the world. */
  const over = (h: HandState, id: string) => {
    const s = stones.find(v => v.def.id === id)!;
    h.point.set(s.pose.x, s.pose.y + 0.01, s.pose.z).applyMatrix4(site.matrixWorld);
  };
  const hover = () => (sys as unknown as { hover(a: ArchRuntime, h: Record<Side, HandState>): StoneView | undefined })
    .hover(arch, hands)?.def.id ?? null;
  return { hands, over, hover };
}

describe('hover mark with the palm up', () => {
  it('palm down marks the stone, palm up marks nothing, down again marks it again', () => {
    const { hands, over, hover } = setup();
    over(hands.right, 'A');
    expect(hover()).toBe('A');
    hands.right.palmUp = true;
    expect(hover()).toBeNull();
    hands.right.palmUp = false;
    expect(hover()).toBe('A');
  });

  it('the other hand, palm down, still marks its own stone while one palm is up', () => {
    const { hands, over, hover } = setup();
    hands.left.tracked = true;
    over(hands.right, 'A');
    over(hands.left, 'B');
    hands.right.palmUp = true;
    expect(hover()).toBe('B');
    hands.left.palmUp = true;
    expect(hover()).toBeNull();
  });
});

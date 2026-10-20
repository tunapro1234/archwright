// Gaze off, in an XR session: GazeSystem's own update watches the gaze icon alone with the head's ray. Looked at for
// GAZE_WAKE_DWELL, the ring shows on it and a pinch of either hand turns gaze on (and is taken); a pinch before that, or
// with the eyes elsewhere, is left to the hands. The system runs on its prototype with a head, a panel and hands stood
// in for; nothing else of the world is needed while gaze is off.
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { GazeSystem, targetRing } from '../src/systems/gaze.js';
import { SelectPlace } from '../src/systems/select.js';
import { GAZE_WAKE_DWELL } from '../src/game/a11y.js';
import type { Side } from '../src/game/arch-state.js';
import type { ArchRuntime } from '../src/game/runtime.js';
import type { HandState } from '../src/systems/hands.js';
import type { A11yKey, A11yPanel } from '../src/systems/a11y.js';

const ICON = new Vector3(0, 1.1, -0.45);  // the gaze icon, in front of the eyes
const STONE = new Vector3(0, 1.1, -0.3);  // something nearer on the same line

function rig(presenting = true) {
  const head = new Object3D();
  head.position.set(0, 1.1, 0); // looks down its -z
  head.updateMatrixWorld(true);
  const hands = Object.fromEntries((['left', 'right'] as const).map(s => [s, {
    tracked: true, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(0.3, 0.8, -0.2), lostFor: 0, palmUp: false,
  }])) as Record<Side, HandState>;
  const settings = { gaze: false, oneHand: false, highContrast: false };
  const toggled: A11yKey[] = [];
  const panel = {
    settings,
    toggle: (k: A11yKey) => { toggled.push(k); settings[k] = !settings[k]; },
    iconAt: (k: A11yKey, out: Vector3) => (k === 'gaze' ? out.copy(ICON) : k === 'oneHand' ? out.copy(STONE) : null),
  } as unknown as A11yPanel;
  const hook = { gaze: { on: false, target: null as string | null, stone: null as string | null, wake: 0 } };
  const arch = { state: { placed: [] }, generation: 0, shown: true, gaze: { on: false, stone: undefined }, hook } as unknown as ArchRuntime;
  const sys = Object.create(GazeSystem.prototype) as GazeSystem;
  Object.defineProperty(sys, 'globals', { value: { arch, hands, a11y: panel } });
  Object.defineProperty(sys, 'renderer', { value: { xr: { isPresenting: presenting } } });
  Object.defineProperty(sys, 'player', { value: { head } });
  const pool = Array.from({ length: 64 }, () => ({ id: '', center: new Vector3(), radius: 0, kind: 'spot' }));
  const ring = targetRing('gaze-ring');
  Object.assign(sys, {
    select: new SelectPlace(), active: false, generation: -1, pool, live: [], hold: undefined, dwell: 0, ring,
    origin: new Vector3(), dir: new Vector3(), v: new Vector3(),
  });
  const frame = (dt = 0.1) => sys.update(dt);
  const look = (at: Vector3) => { head.lookAt(at); head.rotateY(Math.PI); head.updateMatrixWorld(true); };
  return { sys, hands, settings, toggled, hook, ring, frame, look, head };
}

describe('gaze off: the gaze icon wakes gaze', () => {
  it('looked at for GAZE_WAKE_DWELL, the ring comes up and a pinch turns gaze on and is taken', () => {
    const r = rig();
    r.look(ICON);
    for (let i = 0; i < 3; i++) r.frame(0.1);
    expect(r.hook.gaze.wake).toBeCloseTo(0.3, 9);
    expect(r.ring.visible).toBe(false);
    r.hands.left.pinchStarted = true; // too soon: left to the hands
    r.frame(0.1);
    expect(r.toggled).toEqual([]);
    expect(r.hands.left.pinchStarted).toBe(true);
    r.hands.left.pinchStarted = false;
    r.frame(0.1);
    r.frame(0.1);
    expect(r.hook.gaze.wake).toBeGreaterThanOrEqual(GAZE_WAKE_DWELL);
    expect(r.ring.visible).toBe(true);
    expect(r.ring.position.distanceTo(ICON)).toBeLessThan(1e-9);
    r.hands.right.pinchStarted = true;
    r.frame(0.1);
    expect(r.toggled).toEqual(['gaze']);
    expect(r.settings.gaze).toBe(true);
    expect(r.hands.right.pinchStarted).toBe(false);
    expect(r.hook.gaze.wake).toBe(0);
    expect(r.ring.visible).toBe(false);
  });

  it('eyes elsewhere: no dwell, no ring, the pinch is the hands\'', () => {
    const r = rig();
    r.look(new Vector3(0, 1.35, -0.45)); // 25 cm above the icon
    for (let i = 0; i < 10; i++) r.frame(0.1);
    expect(r.hook.gaze.wake).toBe(0);
    r.hands.left.pinchStarted = true;
    r.frame(0.1);
    expect(r.toggled).toEqual([]);
    expect(r.hands.left.pinchStarted).toBe(true);
    expect(r.ring.visible).toBe(false);
  });

  it('looking away sets the dwell back to 0; one long frame adds at most a quarter second', () => {
    const r = rig();
    r.look(ICON);
    r.frame(2);
    expect(r.hook.gaze.wake).toBeCloseTo(0.25, 9);
    r.look(STONE.clone().setX(0.2));
    r.frame(0.1);
    expect(r.hook.gaze.wake).toBe(0);
  });

  it('only the gaze icon counts: another icon on the same line, in front, neither blocks it nor is a target', () => {
    const r = rig();
    r.look(ICON); // the one-hand icon (STONE) is on the way, 15 cm nearer
    for (let i = 0; i < 7; i++) r.frame(0.1);
    expect(r.hook.gaze.wake).toBeGreaterThanOrEqual(GAZE_WAKE_DWELL);
    expect(r.hook.gaze.on).toBe(false);
    expect(r.hook.gaze.target).toBeNull();
    r.hands.left.pinchStarted = true;
    r.frame(0.1);
    expect(r.toggled).toEqual(['gaze']);
  });

  it('outside an XR session nothing is watched', () => {
    const r = rig(false);
    r.look(ICON);
    for (let i = 0; i < 10; i++) r.frame(0.1);
    expect(r.hook.gaze.wake).toBe(0);
    r.hands.left.pinchStarted = true;
    r.frame(0.1);
    expect(r.toggled).toEqual([]);
    expect(r.hands.left.pinchStarted).toBe(true);
  });
});

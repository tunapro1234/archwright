// The centering's grip through a short loss of tracking (CenteringSystem, src/systems/centering.ts): HandSystem keeps
// a pinch for LOST_AFTER without tracking, so the grip on the handle is kept as long, without pulling while the hand
// is gone, and the pull goes on from the same grip when the hand comes back; a longer loss lets go. CenteringSystem
// runs on stand-ins for ArchRuntime (a site, a handle, the pull) and HandSystem's state for the right hand.
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { CenteringSystem } from '../src/systems/centering.js';
import { LOST_AFTER, type HandState } from '../src/systems/hands.js';

const DT = 1 / 72;

function setup() {
  const site = new Object3D();
  site.position.set(0.1, 0.75, -0.5);
  site.updateMatrixWorld();
  const handle = new Object3D();
  handle.position.set(0, 0.02, 0.06);
  site.add(handle);
  site.updateMatrixWorld(true);
  const centering = { mesh: new Object3D(), handle, pull: 0, struck: false, auto: false };
  const arch = { centering, site, state: { placed: [{}] }, def: { depth: 0.08 }, strikeRequested: false };
  const hand = (): HandState => ({
    tracked: false, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(), lostFor: 0, palmUp: false,
  });
  const hands = { left: hand(), right: hand() };
  const sys = Object.create(CenteringSystem.prototype) as CenteringSystem;
  Object.assign(sys, {
    world: { globals: { arch, hands } },
    grip: { left: undefined, right: undefined }, local: new Vector3(), hp: new Vector3(), scraped: false,
  });
  const h = hands.right;
  const start = handle.getWorldPosition(new Vector3());

  /** One frame of HandSystem then CenteringSystem: the right hand at `start` + dz (or lost), pinching or not. */
  const frame = (o: { tracked: boolean; pinching: boolean; dz?: number }) => {
    h.pinchStarted = h.pinchEnded = false;
    if (o.tracked) {
      h.tracked = true;
      h.lostFor = 0;
      h.point.copy(start).add(new Vector3(0, 0, o.dz ?? 0));
      if (o.pinching !== h.pinching) { h.pinchStarted = o.pinching; h.pinchEnded = !o.pinching; h.pinching = o.pinching; }
    } else {
      h.tracked = false;
      h.lostFor += DT;
      if (h.pinching && h.lostFor > LOST_AFTER) { h.pinching = false; h.pinchEnded = true; }
    }
    sys.update(DT, 0);
  };
  const lose = (s: number) => { for (let t = 0; t < s - 1e-9; t += DT) frame({ tracked: false, pinching: true }); };
  return { arch: arch as typeof arch & { shown?: boolean }, centering, frame, lose, gripped: () => !!(sys as unknown as { grip: Record<string, unknown> }).grip.right };
}

describe('centering grip through a tracking loss', () => {
  it('0.2 s lost: the grip is kept, the pull holds while the hand is gone and goes on when it comes back', () => {
    const { centering, frame, lose, gripped } = setup();
    frame({ tracked: true, pinching: true });
    expect(gripped()).toBe(true);
    frame({ tracked: true, pinching: true, dz: 0.02 });
    expect(centering.pull).toBeCloseTo(0.02, 6);
    lose(0.2);
    expect(gripped()).toBe(true);
    expect(centering.pull).toBeCloseTo(0.02, 6); // no pull while the hand is gone
    frame({ tracked: true, pinching: true, dz: 0.035 }); // back, no new pinchStarted
    expect(gripped()).toBe(true);
    expect(centering.pull).toBeCloseTo(0.035, 6);
  });

  it('0.35 s lost: the grip is let go, and the hand coming back does not pull', () => {
    const { centering, frame, lose, gripped } = setup();
    frame({ tracked: true, pinching: true });
    frame({ tracked: true, pinching: true, dz: 0.02 });
    expect(LOST_AFTER).toBeLessThan(0.35);
    lose(0.35);
    expect(gripped()).toBe(false);
    frame({ tracked: true, pinching: false, dz: 0.04 });
    expect(gripped()).toBe(false);
    expect(centering.pull).toBeCloseTo(0.02, 6);
  });

  it('a pinch that ends lets go at once, tracked or not', () => {
    const { frame, gripped } = setup();
    frame({ tracked: true, pinching: true });
    frame({ tracked: true, pinching: false });
    expect(gripped()).toBe(false);
  });
});

describe('centering grip on a hidden board', () => {
  it('shown false (no surface yet in this session): a pinch on the handle takes nothing; shown true or unset: it does', () => {
    const hidden = setup();
    hidden.arch.shown = false;
    hidden.frame({ tracked: true, pinching: true });
    hidden.frame({ tracked: true, pinching: true, dz: 0.02 });
    expect(hidden.gripped()).toBe(false);
    expect(hidden.centering.pull).toBe(0);
    for (const shown of [true, undefined]) {
      const t = setup();
      t.arch.shown = shown;
      t.frame({ tracked: true, pinching: true });
      t.frame({ tracked: true, pinching: true, dz: 0.02 });
      expect(t.gripped()).toBe(true);
      expect(t.centering.pull).toBeCloseTo(0.02, 6);
    }
  });
});

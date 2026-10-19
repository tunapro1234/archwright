// The spot mark before a pinch in an XR session (src/game/a11y.ts nearestSpot and handSpot, src/systems/spot-hover.ts):
// the nearest spot within twice its radius, kept while a hand wavers between two; nothing for a hand that pinches, has
// its palm up, is not tracked or already marks a stone, and nothing at all in gaze mode. SpotHoverSystem runs on its
// prototype with stand-ins for the runtime, the loop's spots and the accessibility panel, so the reach it gives each
// spot is checked against the pick radius that takes it.
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import { handSpot, nearestSpot, SPOT_HOLD, type GazeTarget, type SpotHand } from '../src/game/a11y.js';
import { SpotHoverSystem } from '../src/systems/spot-hover.js';
import { targetRing } from '../src/systems/gaze.js';
import { PICK_RADIUS } from '../src/systems/loop.js';
import { ICON_PICK, type A11yPanel } from '../src/systems/a11y.js';
import type { HandState } from '../src/systems/hands.js';
import type { ArchRuntime } from '../src/game/runtime.js';
import type { Side } from '../src/game/arch-state.js';

const r = 0.03;
const A: GazeTarget = { id: 'marker:a', center: { x: 0, y: 0, z: 0 }, radius: r };
const B: GazeTarget = { id: 'marker:b', center: { x: 0.05, y: 0, z: 0 }, radius: r };

describe('nearestSpot', () => {
  it('a spot 1 cm away is marked, one just past twice its radius is not', () => {
    expect(nearestSpot({ x: 0, y: 0.01, z: 0 }, [A], null)).toBe('marker:a');
    expect(nearestSpot({ x: 0, y: 2 * r + 0.001, z: 0 }, [A], null)).toBeNull();
    expect(nearestSpot({ x: 0, y: 0, z: 0 }, [], null)).toBeNull();
  });

  it('of two spots, the nearer', () => {
    expect(nearestSpot({ x: 0.04, y: 0.01, z: 0 }, [A, B], null)).toBe('marker:b');
    expect(nearestSpot({ x: 0.01, y: 0.01, z: 0 }, [A, B], null)).toBe('marker:a');
  });

  it('halfway between two spots 5 cm apart, a hand moving ±2 mm keeps the spot it had', () => {
    for (const prev of ['marker:a', 'marker:b']) {
      for (const dx of [-0.002, -0.001, 0, 0.001, 0.002]) {
        expect(nearestSpot({ x: 0.025 + dx, y: 0.005, z: 0 }, [A, B], prev)).toBe(prev);
      }
    }
    // Clearly nearer the other one (more than SPOT_HOLD), or the old one out of reach: the mark moves.
    expect(nearestSpot({ x: 0.025 + SPOT_HOLD + 0.001, y: 0, z: 0 }, [A, B], 'marker:a')).toBe('marker:b');
    expect(nearestSpot({ x: 0, y: 2 * r + SPOT_HOLD + 0.001, z: 0 }, [A], 'marker:a')).toBeNull();
    // A kept spot holds a little past its reach (SPOT_HOLD), a fresh one does not.
    expect(nearestSpot({ x: 0, y: 2 * r + 0.002, z: 0 }, [A], 'marker:a')).toBe('marker:a');
    expect(nearestSpot({ x: 0, y: 2 * r + 0.002, z: 0 }, [A], null)).toBeNull();
  });
});

describe('handSpot', () => {
  const hand = (x: number, more: Partial<SpotHand> = {}): SpotHand =>
    ({ tracked: true, pinching: false, palmUp: false, stone: false, point: { x, y: 0.01, z: 0 }, ...more });

  it('a hand over a spot marks it; pinching, palm up, untracked or over a stone it marks nothing', () => {
    expect(handSpot([hand(0)], [A, B], null, false)).toBe('marker:a');
    expect(handSpot([hand(0, { pinching: true })], [A, B], null, false)).toBeNull();
    expect(handSpot([hand(0, { palmUp: true })], [A, B], null, false)).toBeNull();
    expect(handSpot([hand(0, { tracked: false })], [A, B], null, false)).toBeNull();
    expect(handSpot([hand(0, { stone: true })], [A, B], null, false)).toBeNull();
  });

  it('gaze mode: no spot mark, whatever the hands do', () => {
    expect(handSpot([hand(0), hand(0.05)], [A, B], null, true)).toBeNull();
    expect(handSpot([hand(0)], [A, B], 'marker:a', true)).toBeNull();
  });

  it('two hands: the one nearer its spot; a palm-up hand leaves it to the other', () => {
    expect(handSpot([hand(0.012), hand(0.051)], [A, B], null, false)).toBe('marker:b');
    expect(handSpot([hand(0.012), hand(0.051, { palmUp: true })], [A, B], null, false)).toBe('marker:a');
    expect(handSpot([hand(0.012, { stone: true }), hand(0.08)], [A, B], null, false)).toBe('marker:b');
  });
});

describe('SpotHoverSystem', () => {
  function setup(gaze = false) {
    const marker = new Vector3(0.1, 0.76, -0.4), icon = new Vector3(-0.2, 0.76, -0.3);
    const hand = (): HandState => ({
      tracked: true, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(0, 2, 0), lostFor: 0, palmUp: false,
    });
    const hands: Record<Side, HandState> = { left: hand(), right: hand() };
    const arch = {
      state: {}, shown: true, hook: { handHover: null }, handStone: { left: undefined, right: undefined },
    } as unknown as ArchRuntime;
    const panel = {
      settings: { gaze, oneHand: false, highContrast: false },
      iconAt: (k: string, out: Vector3) => (k === 'gaze' ? out.copy(icon) : null),
    } as unknown as A11yPanel;
    const loop = { forEachSpot: (fn: (id: string, at: Vector3, r: number) => void) => fn('marker:today', marker, PICK_RADIUS) };
    const sys = Object.create(SpotHoverSystem.prototype) as SpotHoverSystem;
    const head = new Object3D();
    head.position.set(0, 1.15, 0.05);
    Object.defineProperty(sys, 'globals', { value: { arch, hands, a11y: panel, loop } });
    Object.defineProperty(sys, 'renderer', { value: { xr: { isPresenting: true } }, configurable: true });
    Object.defineProperty(sys, 'player', { value: { head } });
    const ring = targetRing('spot-ring');
    Object.assign(sys, {
      pool: [], live: [], ring, head: new Vector3(), v: new Vector3(),
      hands: Object.fromEntries((['left', 'right'] as const).map(s => [s, { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() }])),
    });
    const own = sys as unknown as { hands: Record<Side, SpotHand>; both: SpotHand[]; spotFn: unknown; add(id: string, at: Vector3, r: number): void };
    own.both = [own.hands.left, own.hands.right];
    own.spotFn = (id: string, at: Vector3, r: number) => own.add(id, at, r);
    const at = (p: Vector3, dy: number) => { hands.right.point.set(p.x, p.y + dy, p.z); sys.update(0, 0); return arch.hook.handHover; };
    return { sys, arch, hands, marker, icon, ring, at };
  }

  it('marks a marker or an icon only within the radius a pinch takes it, with the ring', () => {
    const { at, marker, icon, ring } = setup();
    expect(at(marker, 0.01)).toBe('marker:today');
    expect(ring.visible).toBe(true);
    expect(at(marker, 0.3)).toBeNull();
    expect(ring.visible).toBe(false);
    expect(at(marker, PICK_RADIUS - 0.001)).toBe('marker:today');
    expect(at(marker, 0.3)).toBeNull();
    expect(at(marker, PICK_RADIUS + 0.001)).toBeNull(); // a pinch here takes nothing (loop.ts PICK_RADIUS)
    expect(at(icon, 0.01)).toBe('a11y:gaze');
    expect(at(icon, ICON_PICK + 0.001)).toBe('a11y:gaze'); // kept: within SPOT_HOLD past its reach
    expect(at(marker, 0.3)).toBeNull();
    expect(at(icon, ICON_PICK + 0.001)).toBeNull();
  });

  it('nothing while the hand marks a stone, has its palm up, in gaze mode or outside XR', () => {
    const { at, marker, hands, arch, sys } = setup();
    (arch.handStone as Record<Side, unknown>).right = {};
    expect(at(marker, 0.01)).toBeNull();
    (arch.handStone as Record<Side, unknown>).right = undefined;
    hands.right.palmUp = true;
    expect(at(marker, 0.01)).toBeNull();
    hands.right.palmUp = false;
    expect(at(marker, 0.01)).toBe('marker:today');
    Object.defineProperty(sys, 'renderer', { value: { xr: { isPresenting: false } } });
    expect(at(marker, 0.01)).toBeNull();
    const g = setup(true);
    expect(g.at(g.marker, 0.01)).toBeNull();
    expect(g.ring.visible).toBe(false);
  });
});

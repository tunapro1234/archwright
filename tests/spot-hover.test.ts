// The spot mark before a pinch in an XR session (src/game/a11y.ts nearestSpot and handSpot, src/systems/spot-hover.ts):
// the nearest spot within twice its radius, kept while a hand wavers between two; nothing for a hand that pinches, has
// its palm up, is not tracked or already marks a stone, and nothing at all in gaze mode. SpotHoverSystem runs on its
// prototype with stand-ins for the runtime, the loop's spots and the accessibility panel, so the reach it gives each
// spot is checked against the pick radius that takes it.
import { describe, expect, it } from 'vitest';
import { Object3D, Vector3, type Mesh } from '@iwsdk/core';
import { handSpot, nearestSpot, SPOT_HOLD, type GazeTarget, type SpotHand } from '../src/game/a11y.js';
import { SpotHoverSystem } from '../src/systems/spot-hover.js';
import { SpotList } from '../src/systems/spots.js';
import { targetRing } from '../src/systems/gaze.js';
import { GameLoopSystem, PICK_RADIUS } from '../src/systems/loop.js';
import { dailySpot, markerSpots } from '../src/scene/layout.js';
import { LEVELS } from '../src/levels/index.js';
import { localDateISO } from '../src/game/daily.js';
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

  it('the old spot is kept between two spots, but not past the reach a pinch takes it', () => {
    // 5 cm apart, reach 2r = 6 cm: halfway the hand keeps what it had, either way.
    expect(handSpot([hand(0.026)], [A, B], 'marker:a', false)).toBe('marker:a');
    expect(handSpot([hand(0.024)], [A, B], 'marker:b', false)).toBe('marker:b');
    // Pick reach + 2 mm from the old spot, with no other near: nothing, though nearestSpot alone would keep it.
    const far = { x: 0, y: 2 * r + 0.002, z: 0 };
    expect(nearestSpot(far, [A], 'marker:a')).toBe('marker:a');
    expect(handSpot([{ ...hand(0), point: far }], [A], 'marker:a', false)).toBeNull();
  });

  it('two hands: the one nearer its spot; a palm-up hand leaves it to the other', () => {
    expect(handSpot([hand(0.012), hand(0.051)], [A, B], null, false)).toBe('marker:b');
    expect(handSpot([hand(0.012), hand(0.051, { palmUp: true })], [A, B], null, false)).toBe('marker:a');
    expect(handSpot([hand(0.012, { stone: true }), hand(0.08)], [A, B], null, false)).toBe('marker:b');
  });
});

/** SpotHoverSystem on its prototype, with stand-ins for the world it reads. */
function rig(arch: ArchRuntime, hands: Record<Side, HandState>, panel: A11yPanel, loop: unknown): SpotHoverSystem {
  const sys = Object.create(SpotHoverSystem.prototype) as SpotHoverSystem;
  const head = new Object3D();
  head.position.set(0, 1.15, 0.05);
  Object.defineProperty(sys, 'globals', { value: { arch, hands, a11y: panel, loop } });
  Object.defineProperty(sys, 'renderer', { value: { xr: { isPresenting: true } }, configurable: true });
  Object.defineProperty(sys, 'player', { value: { head } });
  const spots = new SpotList();
  Object.assign(sys, {
    spots, ring: targetRing('spot-ring'), head: new Vector3(), v: new Vector3(),
    spotFn: (id: string, at: Vector3, r: number) => spots.add(id, at, r),
    hands: Object.fromEntries((['left', 'right'] as const).map(s => [s, { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() }])),
  });
  return sys;
}

/** SpotHoverSystem with one marker (Today's Span) and one icon (gaze), a stand-in loop and panel that record what is taken. */
function setup(gaze = false) {
  const marker = new Vector3(0.1, 0.76, -0.4), icon = new Vector3(-0.2, 0.76, -0.3);
  const hand = (): HandState => ({
    tracked: true, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(0, 2, 0), lostFor: 0, palmUp: false,
  });
  const hands: Record<Side, HandState> = { left: hand(), right: hand() };
  const arch = {
    state: {}, shown: true, stones: [], handStone: { left: undefined, right: undefined },
    hook: { handHover: null, pinchTarget: { left: null, right: null } },
  } as unknown as ArchRuntime;
  const toggled: string[] = [], taken: string[] = [];
  const panel = {
    settings: { gaze, oneHand: false, highContrast: false },
    iconAt: (k: string, out: Vector3) => (k === 'gaze' ? out.copy(icon) : null),
    toggle: (k: string) => toggled.push(k),
  } as unknown as A11yPanel;
  const loop = {
    forEachSpot: (fn: (id: string, at: Vector3, r: number) => void) => fn('marker:today', marker, PICK_RADIUS),
    take: (id: string) => taken.push(id) > 0,
  };
  const sys = rig(arch, hands, panel, loop);
  const ring = (sys as unknown as { ring: Mesh }).ring;
  const at = (p: Vector3, dy: number) => { hands.right.point.set(p.x, p.y + dy, p.z); sys.update(0, 0); return arch.hook.handHover; };
  return { sys, arch, hands, marker, icon, ring, at, toggled, taken };
}

describe('SpotHoverSystem', () => {
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
    expect(at(icon, ICON_PICK + 0.001)).toBeNull();
    // Even when it was marked a frame before, a spot is let go just past the pick's reach: the ring never shows what a
    // pinch would not take (nearestSpot's SPOT_HOLD would keep it, handSpot does not hand it the old spot there).
    expect(at(marker, 0.01)).toBe('marker:today');
    expect(at(marker, PICK_RADIUS + 0.002)).toBeNull();
    expect(at(icon, 0.005)).toBe('a11y:gaze');
    expect(at(icon, ICON_PICK + 0.002)).toBeNull();
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

describe('a hand\'s pinch takes the spot its ring is on, and only that', () => {
  const pinch = (sys: SpotHoverSystem, h: HandState) => {
    h.pinching = h.pinchStarted = true;
    sys.update(0, 0);
    const left = h.pinchStarted;
    h.pinching = h.pinchStarted = false;
    return left; // still there: no spot took it
  };

  it('the ringed marker or icon; with no ring, nothing', () => {
    const { sys, arch, hands, at, marker, icon, taken, toggled } = setup();
    expect(at(marker, 0.01)).toBe('marker:today');
    expect(arch.hook.pinchTarget.right).toBe('marker:today');
    expect(pinch(sys, hands.right)).toBe(false);
    expect(taken).toEqual(['marker:today']);
    expect(at(icon, 0.01)).toBe('a11y:gaze');
    expect(pinch(sys, hands.right)).toBe(false);
    expect(toggled).toEqual(['gaze']);
    // Just past the pick's reach: no ring, and the pinch takes no spot.
    expect(at(marker, PICK_RADIUS + 0.001)).toBeNull();
    expect(arch.hook.pinchTarget.right).toBeNull();
    expect(pinch(sys, hands.right)).toBe(true);
    expect(taken).toEqual(['marker:today']);
  });

  it('a palm-up hand, a hand holding a stone, or gaze mode: the pinch takes no spot', () => {
    const { sys, arch, hands, at, marker, taken } = setup();
    hands.right.palmUp = true;
    expect(at(marker, 0.01)).toBeNull();
    expect(pinch(sys, hands.right)).toBe(true);
    hands.right.palmUp = false;
    expect(at(marker, 0.01)).toBe('marker:today');
    (arch.stones as unknown as { mode: string; heldBy: Side }[]).push({ mode: 'held', heldBy: 'right' }); // its pinch took a stone
    expect(pinch(sys, hands.right)).toBe(true);
    expect(taken).toEqual([]);
    const g = setup(true);
    expect(g.at(g.marker, 0.01)).toBeNull();
    expect(pinch(g.sys, g.hands.right)).toBe(true); // left to GazeSystem
    expect(g.taken).toEqual([]);
  });

  // The real loop: GameLoopSystem's own spots and its own pinch (the level it loads), on the board's layout with the site
  // at the origin. Between w1-1 and w1-2 (5 cm apart) and between Today's Span and w2-1 (4.5 cm) both are in a pinch's
  // reach; the level the pinch loads is the spot the ring was on, wherever the hand is in the band.
  function realLoop() {
    const ids = LEVELS.map(l => l.id);
    const loaded: string[] = [];
    const hands: Record<Side, HandState> = Object.fromEntries((['left', 'right'] as const).map(s => [s, {
      tracked: true, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(0, 2, 0), lostFor: 0, palmUp: false,
    }])) as Record<Side, HandState>;
    const arch = {
      state: { placed: [] }, def: { id: 'w3-5' }, shown: true, site: new Object3D(), stones: [],
      handStone: { left: undefined, right: undefined },
      hook: { handHover: null, pinchTarget: { left: null, right: null } },
      load: (def: { id: string }) => loaded.push(def.id),
    } as unknown as ArchRuntime;
    const today = dailySpot(ids);
    const daily = new Object3D();
    daily.position.set(today.x, 0, today.z);
    const loopSys = Object.create(GameLoopSystem.prototype) as GameLoopSystem;
    Object.defineProperty(loopSys, 'globals', { value: { arch } });
    Object.assign(loopSys, {
      rebuild: { visible: false }, tablet: { group: { visible: false } }, daily, spots: markerSpots(ids), open: new Set(ids),
      v: new Vector3(), w: new Vector3(),
    });
    const own = loopSys as unknown as { forEachSpot(fn: unknown): void; pinch(a: ArchRuntime, id: string): boolean };
    const loop = { forEachSpot: (fn: unknown) => own.forEachSpot(fn), take: (id: string) => own.pinch(arch, id) };
    const panel = { settings: { gaze: false }, iconAt: () => null, toggle: () => undefined } as unknown as A11yPanel;
    const sys = rig(arch, hands, panel, loop);
    const spot = (id: string) => { const m = markerSpots(ids).find(s => s.id === id)!; return new Vector3(m.x, 0.006, m.z); };
    return { sys, arch, hands, loaded, spot, today: new Vector3(today.x, 0, today.z) };
  }

  it('between w1-1 and w1-2, and between Today\'s Span and w2-1: the level loaded is the ringed one', () => {
    const r = realLoop();
    const bands: [Vector3, Vector3, string][] = [
      [r.spot('w1-1'), r.spot('w1-2'), 'w1-1/w1-2'],
      [r.today, r.spot('w2-1'), 'today/w2-1'],
    ];
    let rung = 0;
    for (const [A, B, band] of bands) {
      for (let k = 0; k <= 20; k++) {
        for (const dy of [0.005, 0.008]) {
          const p = A.clone().lerp(B, k / 20).add(new Vector3(0, dy, 0));
          r.hands.right.point.copy(p);
          r.sys.update(0, 0);
          const ring = r.arch.hook.handHover;
          expect(r.arch.hook.pinchTarget.right, `${band} ${k}`).toBe(ring);
          r.loaded.length = 0;
          r.hands.right.pinching = r.hands.right.pinchStarted = true;
          r.sys.update(0, 0);
          r.hands.right.pinching = r.hands.right.pinchStarted = false;
          const want = ring === null ? [] : [ring === 'marker:today' ? `daily-${localDateISO()}` : ring.slice('marker:'.length)];
          expect(r.loaded, `${band} ${k} ring ${ring}`).toEqual(want);
          if (ring) rung++;
        }
      }
    }
    expect(rung).toBeGreaterThan(40);
    // The point the review found: z = 0.008 between w1-1 (z -0.02) and w1-2 (z 0.03) is in both picks' reach; the old
    // pinch took w1-1, the first in its list, while the ring was on w1-2, the nearer.
    r.hands.right.point.set(r.spot('w1-1').x, 0.011, 0.008);
    r.sys.update(0, 0);
    expect(r.arch.hook.handHover).toBe('marker:w1-2');
    r.loaded.length = 0;
    r.hands.right.pinching = r.hands.right.pinchStarted = true;
    r.sys.update(0, 0);
    expect(r.loaded).toEqual(['w1-2']);
  });
});

// One page through several XR sessions (src/game/session-cycle.ts): hit-test sources of an ended session that throw on
// cancel, the rule that builds a falling or fallen arch again on the next session, and when the hit-test rings are up;
// then SurfaceSystem's own startSession (src/systems/surface.ts) applying that rule at each session start and end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from '@iwsdk/core';
import { SurfaceSystem } from '../src/systems/surface.js';
import { cancelHitSources, pickingAllowed, safeCancel, sessionCycleAction } from '../src/game/session-cycle.js';
import type { Phase } from '../src/game/arch-state.js';
import type { SurfaceInput, SurfaceKind } from '../src/scene/surface-chain.js';

/** A hit-test source whose cancel counts its calls, and throws as an ended session's does when `ended`. */
function source(ended: boolean) {
  const s = {
    calls: 0,
    cancel() {
      s.calls++;
      if (ended) throw { name: 'InvalidStateError' };
    },
  };
  return s;
}

describe('cancelHitSources', () => {
  it('a source that throws and a pending one: nothing escapes, both slots empty, cancel once; a second call does nothing', () => {
    const left = source(true);
    const slots: Record<'left' | 'right', { cancel(): void } | null | 'pending'> = { left, right: 'pending' };
    expect(() => cancelHitSources(slots)).not.toThrow();
    expect(slots).toEqual({ left: null, right: null });
    expect(left.calls).toBe(1);
    cancelHitSources(slots);
    expect(left.calls).toBe(1);
  });

  it('every slot already empty: nothing happens', () => {
    const slots = { left: null, right: null };
    cancelHitSources(slots);
    expect(slots).toEqual({ left: null, right: null });
  });

  it('a source that does not throw is cancelled once', () => {
    const right = source(false);
    const slots: Record<'left' | 'right', { cancel(): void } | null | 'pending'> = { left: null, right };
    cancelHitSources(slots);
    expect(right.calls).toBe(1);
    expect(slots.right).toBeNull();
  });

  it('the slot is empty before its source is cancelled', () => {
    const slots: Record<'left', { cancel(): void } | null | 'pending'> = { left: null };
    let seen: unknown = 'unset';
    slots.left = { cancel() { seen = slots.left; } };
    cancelHitSources(slots);
    expect(seen).toBeNull();
  });
});

describe('safeCancel', () => {
  it('a source that throws: nothing escapes', () => {
    const s = source(true);
    expect(() => safeCancel(s)).not.toThrow();
    expect(s.calls).toBe(1);
  });
});

describe('sessionCycleAction', () => {
  it.each<[Phase, number, boolean, 'keep' | 'rebuild']>([
    ['building', 0, false, 'keep'],
    ['ready', 0, false, 'keep'],
    ['held', 0, false, 'keep'],
    ['collapsed', 0, false, 'rebuild'],
    ['collapsed', 5, false, 'rebuild'],
    ['building', 1, false, 'rebuild'],
    ['ready', 0, true, 'rebuild'],
  ])('%s, %i dynamic, collapse requested %s → %s', (phase, dynamic, collapseRequested, action) => {
    expect(sessionCycleAction({ phase, dynamic, collapseRequested })).toBe(action);
  });
});

describe('pickingAllowed', () => {
  it.each<[SurfaceKind | null, SurfaceInput['force'], SurfaceKind, boolean]>([
    [null, undefined, 'pick', true],
    ['lap', undefined, 'pick', false],
    [null, 'pick', 'mesh', true],
    [null, undefined, 'mesh', false],
    ['mesh', undefined, 'mesh', false],
  ])('placed %s, force %s, choice %s → %s', (placed, force, choice, allowed) => {
    expect(pickingAllowed({ placed, force, choice })).toBe(allowed);
  });
});

describe('SurfaceSystem.startSession', () => {
  // No AudioContext in node: unlockAudio, on entering a session, finds none and does nothing.
  beforeEach(() => { vi.stubGlobal('window', {}); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** The real startSession on a SurfaceSystem with only the fields it reads, an ArchRuntime stand-in counting its loads,
   *  and place() (the board's placing, covered elsewhere) left out. */
  function setup() {
    const arch = {
      state: { phase: 'building' as Phase }, stones: [] as { mode: string }[], collapseRequested: false,
      def: { id: 'w1-1' }, loads: 0, desk: null as unknown, shown: true, hook: {} as Record<string, unknown>,
      load(def: unknown) { expect(def).toBe(arch.def); arch.loads++; },
      setShown(v: boolean) { arch.shown = v; },
    };
    const sys = Object.create(SurfaceSystem.prototype) as SurfaceSystem;
    Object.assign(sys, {
      session: undefined, elapsed: 0, placed: null, latch: { gen: -1, seated: false }, moves: 0, hasPicked: false,
      hitSources: { left: null, right: null }, hitTest: false,
      input_: { inXR: false, passthrough: false, head: { x: 0, y: 1.15, z: 0 }, fwd: { x: 0, z: -1 }, candidates: [], hitTest: false, elapsed: 0 },
      desk: new Object3D(), atelier: new Object3D(), scene: { background: null }, background: null,
      place() {},
    });
    const start = (session: object | null) =>
      (sys as unknown as { startSession(a: unknown, s: unknown): void }).startSession(arch, session);
    const xr = { environmentBlendMode: 'alpha-blend', enabledFeatures: [] };
    return { arch, start, xr };
  }

  it('the page\'s first call does not rebuild, even with the arch fallen', () => {
    const { arch, start } = setup();
    arch.state.phase = 'collapsed';
    start(null);
    expect(arch.loads).toBe(0);
  });

  it('fallen, falling or with a collapse asked for: built again at every later start or end of a session', () => {
    const { arch, start, xr } = setup();
    start(null); // the page opens
    arch.state.phase = 'collapsed';
    start(null);
    expect(arch.loads).toBe(1);
    arch.state.phase = 'building';
    arch.stones = [{ mode: 'placed' }, { mode: 'dynamic' }];
    start(xr);
    expect(arch.loads).toBe(2);
    arch.stones = [];
    arch.state.phase = 'ready';
    arch.collapseRequested = true;
    start(null);
    expect(arch.loads).toBe(3);
  });

  it('building or held, stones placed or one in hand: kept as it is', () => {
    const { arch, start, xr } = setup();
    start(null);
    arch.stones = [{ mode: 'placed' }, { mode: 'tray' }];
    for (const phase of ['building', 'held'] as Phase[]) {
      arch.state.phase = phase;
      start(xr);
      start(null);
    }
    arch.stones = [{ mode: 'placed' }, { mode: 'held' }];
    start(xr);
    start(null);
    expect(arch.loads).toBe(0);
  });
});

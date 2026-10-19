// One page through several XR sessions (src/game/session-cycle.ts): hit-test sources of an ended session that throw on
// cancel, the rule that builds a falling or fallen arch again on the next session, and when the hit-test rings are up.
import { describe, expect, it } from 'vitest';
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

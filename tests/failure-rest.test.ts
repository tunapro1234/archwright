// The failure marks after a collapse (StaticsSystem, src/systems/statics.ts): up in the silence after the strike, then
// down to FAIL_REST once the stones fall, and there they stay, still on the site, for as long as the level lasts (the
// level's clear() frees them). StaticsSystem runs on a stand-in for ArchRuntime with w1-1's real state; CollapseSystem's
// part (taking the collapse request) is one line here.
import { describe, expect, it } from 'vitest';
import { Object3D, type Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import { createLevel, placeStone, type GameState } from '../src/game/arch-state.js';
import { LEVELS } from '../src/levels/index.js';
import { FAIL_OUT, FAIL_REST, SILENCE, StaticsSystem } from '../src/systems/statics.js';

function run(steps: 'trap' | 'solution') {
  const def = LEVELS.find(l => l.id === 'w1-1')!;
  let state: GameState = createLevel(def);
  for (const st of def[steps]) state = placeStone(state, st.stone, st.side);
  const arch = {
    def, state, site: new Object3D(), strikeRequested: true, collapseRequested: false,
    hook: { state: 'ready', failure: null, marks: null } as { state: string; failure: unknown; marks: number | null },
  } as Record<string, unknown> & { hook: { marks: number | null }; site: Object3D; failureMarks?: Mesh; collapseRequested: boolean };
  const sys = Object.create(StaticsSystem.prototype) as StaticsSystem;
  Object.assign(sys, { world: { globals: { arch } }, pending: -1, glow: 0, failIn: 0, failOut: -1 });
  let t = 0;
  const frame = (dt = 1 / 72) => {
    sys.update(dt, t += dt);
    arch.collapseRequested = false; // CollapseSystem takes it the same frame
  };
  return { arch, frame, at: () => t };
}

describe('failure marks after a collapse', () => {
  it('FAIL_REST is 0.35', () => expect(FAIL_REST).toBe(0.35));

  it('w1-1 trap: up in the silence, down to FAIL_REST once the stones fall, and kept on the site', () => {
    const { arch, frame, at } = run('trap');
    frame();
    const m = arch.failureMarks!;
    expect(m).toBeDefined();
    expect(m.parent).toBe(arch.site);
    while (at() < SILENCE - 0.05) frame();
    expect(arch.hook.marks).toBeGreaterThan(0.9); // seen in the silence
    while (at() < SILENCE + FAIL_OUT / 2) frame();
    expect(arch.hook.marks!).toBeLessThan(0.9);
    expect(arch.hook.marks!).toBeGreaterThan(FAIL_REST);
    // The 'collapsed' still is taken SILENCE + 4 s after the strike; and long after, the marks are still there.
    for (const until of [SILENCE + 4, SILENCE + 60]) {
      while (at() < until) frame();
      expect(arch.failureMarks).toBe(m);
      expect(m.parent).toBe(arch.site);
      expect((m.material as MeshBasicMaterial).opacity).toBeCloseTo(FAIL_REST, 9);
      expect(arch.hook.marks).toBeCloseTo(FAIL_REST, 9);
    }
  });

  it('w1-1 solution: it holds, no marks, marks stays null', () => {
    const { arch, frame, at } = run('solution');
    while (at() < SILENCE + 2) frame();
    expect(arch.failureMarks).toBeUndefined();
    expect(arch.hook.marks).toBeNull();
  });
});

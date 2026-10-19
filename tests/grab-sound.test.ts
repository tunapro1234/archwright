// The sounds of taking a stone and of a stone going home (music.grabCue, music.homeCue), and where they are played:
// GrabSnapSystem.tryGrab knocks with the stone's material (each of the three), a click in DesktopSystem and a look and a
// pinch in GazeSystem knock when they lift a stone, ArchRuntime.sendHome slides (a second click or pick too), and a refused
// placement (ArchRuntime.place) plays only its refusal, not the slide as well. synth.ts is replaced by recording stand-ins, so
// nothing here makes a sound; ArchRuntime and the systems run on their prototypes with a real level's state.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';

vi.mock('../src/audio/synth.js', () => ({
  playCue: vi.fn(), playReject: vi.fn(), playStone: vi.fn(),
}));

import { playCue, playReject, playStone } from '../src/audio/synth.js';
import { CUE_MAX_VOICES, grabCue, homeCue } from '../src/audio/music.js';
import { ArchRuntime, type StoneView } from '../src/game/runtime.js';
import { GrabSnapSystem } from '../src/systems/grab-snap.js';
import { GazeSystem } from '../src/systems/gaze.js';
import { DesktopSystem } from '../src/systems/desktop.js';
import { SelectPlace } from '../src/systems/select.js';
import { createLevel, type LevelDef, type Material, type Side } from '../src/game/arch-state.js';
import type { HandState } from '../src/systems/hands.js';
import { LEVELS } from '../src/levels/index.js';

const end = (c: { t: number; dur: number }[]) => Math.max(...c.map(e => e.t + e.dur));

describe('grabCue and homeCue', () => {
  it('a grab is a short knock, lower for the heavier stone, the same every time', () => {
    for (const m of ['sandstone', 'tuff', 'basalt'] as Material[]) {
      const c = grabCue(m);
      expect(c.length).toBeGreaterThanOrEqual(1);
      expect(c.length).toBeLessThanOrEqual(2);
      expect(end(c)).toBeLessThanOrEqual(0.08);
      for (const e of c) { expect(e.hz).toBeGreaterThan(0); expect(e.gain).toBeLessThanOrEqual(0.3); }
      expect(grabCue(m)).toEqual(c);
    }
    const [b, s, t] = (['basalt', 'sandstone', 'tuff'] as Material[]).map(m => grabCue(m)[0].hz!);
    expect(b).toBeLessThan(s);
    expect(s).toBeLessThan(t);
  });

  it('going home is one soft slide under 0.3 s', () => {
    const c = homeCue();
    expect(c.length).toBeGreaterThanOrEqual(1);
    expect(c.length).toBeLessThanOrEqual(2);
    expect(end(c)).toBeLessThanOrEqual(0.3);
    for (const e of c) expect(e.gain).toBeLessThanOrEqual(0.2);
    expect(homeCue()).toEqual(c);
    expect(CUE_MAX_VOICES).toBe(16);
  });
});

/** An ArchRuntime on a level's state (w1-1 by default), with its tray stones as views (only what place/sendHome touch). */
function runtime(def: LevelDef = LEVELS[0]) {
  const arch = Object.create(ArchRuntime.prototype) as ArchRuntime;
  const state = createLevel(def);
  const stones = state.tray.map((s, i) => ({
    def: s, mode: 'tray', home: { x: 0.03 * i, y: 0, z: 0.1, angle: 0, tilt: 0 }, pose: { x: 0.03 * i, y: 0, z: 0.1, angle: 0, tilt: 0 },
  })) as unknown as StoneView[];
  Object.assign(arch, { state, stones, hook: { state: 'ready' } });
  return { arch, def, stones };
}

describe('where the sounds play', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sendHome slides the stone home with homeCue', () => {
    const { arch, stones } = runtime();
    arch.sendHome(stones[0]);
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playCue).mock.calls[0][0]).toEqual(homeCue());
    expect(stones[0].mode).toBe('tween');
    expect(stones[0].tween?.then).toBe('tray');
  });

  it('a refused placement plays its refusal and sends the stone home without the slide', () => {
    const { arch, def, stones } = runtime();
    const first = def.solution[0];
    const v = stones.find(s => s.def.id === first.stone)!;
    const wrong: Side = first.side === 'left' ? 'right' : 'left';
    // The first solution stone seated, then the same stone again: it is not in the tray any more, so refused.
    expect(arch.place(v, first.side)).toBeUndefined();
    expect(playStone).toHaveBeenCalledTimes(1);
    expect(playCue).not.toHaveBeenCalled();
    expect(arch.place(v, wrong)).toBeTruthy();
    expect(playReject).toHaveBeenCalledTimes(1);
    expect(playCue).not.toHaveBeenCalled();
    expect(v.tween?.then).toBe('tray');
  });

  // The first level with a stone of each material in its tray, and that stone.
  const MATERIALS: Material[] = ['basalt', 'sandstone', 'tuff'];
  const withMaterial = (m: Material) => {
    const def = LEVELS.find(l => createLevel(l).tray.some(s => s.material === m));
    if (!def) throw new Error(`no level has a ${m} stone`);
    return def;
  };

  for (const m of MATERIALS) it(`a pinch that takes a ${m} stone knocks as ${m}`, () => {
    const { arch, stones } = runtime(withMaterial(m));
    const site = new Object3D();
    site.position.set(0.1, 0.75, -0.5);
    site.updateMatrixWorld();
    Object.assign(arch, { site, shown: true, stoneById: (id: string) => stones.find(s => s.def.id === id) });
    const sys = Object.create(GrabSnapSystem.prototype) as GrabSnapSystem;
    Object.assign(sys, { held: { left: undefined, right: undefined }, local: new Vector3(), p: new Vector3(), candidates: [], pool: [] });
    const v = stones.find(s => s.def.material === m)!;
    const h: HandState = {
      tracked: true, pinching: true, pinchStarted: true, pinchEnded: false, lostFor: 0, palmUp: false,
      point: new Vector3(v.pose.x, v.pose.y + 0.005, v.pose.z).applyMatrix4(site.matrixWorld),
    };
    (sys as unknown as { tryGrab(a: ArchRuntime, s: Side, h: HandState): void }).tryGrab(arch, 'right', h);
    expect(v.mode).toBe('held');
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playCue).mock.calls[0][0]).toEqual(grabCue(m));
    expect(vi.mocked(playCue).mock.calls[0][0][0].hz).toBe(grabCue(m)[0].hz);
  });

  it('a click in desktop mode: lifting knocks, a second click slides it home, another stone sends the first home and knocks', () => {
    const def = LEVELS.find(l => new Set(createLevel(l).tray.map(s => s.material)).size > 1)!;
    const { arch, stones } = runtime(def);
    Object.assign(arch, { shown: true });
    const sys = Object.create(DesktopSystem.prototype) as DesktopSystem;
    const select = new SelectPlace();
    Object.assign(sys, { select, active: true, refreshFaces: () => {} });
    const click = (v: StoneView) => (sys as unknown as { pick(a: ArchRuntime, v: StoneView): void }).pick(arch, v);
    const a = stones[0], b = stones.find(s => s.def.material !== a.def.material)!;
    expect(b).toBeDefined(); // two materials, so the second knock is told apart from the first
    const played = () => vi.mocked(playCue).mock.calls.map(c => c[0]);

    click(a);
    expect(select.selected).toBe(a);
    expect(played()).toEqual([grabCue(a.def.material)]);
    click(a);
    expect(select.selected).toBeUndefined();
    expect(a.tween?.then).toBe('tray');
    expect(played()).toEqual([grabCue(a.def.material), homeCue()]);

    vi.clearAllMocks();
    click(a);
    click(b);
    expect(select.selected).toBe(b);
    expect(a.tween?.then).toBe('tray');
    expect(played()).toEqual([grabCue(a.def.material), homeCue(), grabCue(b.def.material)]);

    // Off (a session took over): a click does nothing and plays nothing.
    vi.clearAllMocks();
    Object.assign(sys, { active: false });
    click(a);
    expect(played()).toEqual([]);
  });

  it('a look and a pinch that lifts a stone knocks as a click does; picking it again slides it home', () => {
    const { arch, stones } = runtime();
    Object.assign(arch, { shown: true });
    const sys = Object.create(GazeSystem.prototype) as GazeSystem;
    const select = new SelectPlace();
    Object.assign(sys, { select });
    Object.defineProperty(sys, 'globals', { value: {} }); // a getter on the prototype
    const confirm = (v: StoneView) =>
      (sys as unknown as { confirm(a: ArchRuntime, p: unknown, t: unknown, s: Side): void }).confirm(arch, {}, { kind: 'stone', stone: v }, 'right');
    const v = stones[0];
    confirm(v);
    expect(select.selected).toBe(v);
    expect(playCue).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playCue).mock.calls[0][0]).toEqual(grabCue(v.def.material));
    confirm(v);
    expect(select.selected).toBeUndefined();
    expect(playCue).toHaveBeenCalledTimes(2);
    expect(vi.mocked(playCue).mock.calls[1][0]).toEqual(homeCue());
    expect(v.tween?.then).toBe('tray');
  });
});

// A desk found after the board has a place (src/scene/surface-chain.ts mayPlace, stonesBusy, seatLatch): a lap tray or a
// picked spot gives way to it only before the first stone of the board and with no stone in hand or moving; never back.
import { describe, expect, it } from 'vitest';
import {
  chooseSurface, mayPlace, seatLatch, stonesBusy,
  type MoveGuard, type SeatLatch, type SurfaceCandidate, type SurfaceChoice, type SurfaceKind,
} from '../src/scene/surface-chain.js';

const KINDS: SurfaceKind[] = ['desk', 'atelier', 'mesh', 'plane', 'pick', 'lap'];
const UPGRADES = [['lap', 'mesh'], ['lap', 'plane'], ['pick', 'mesh'], ['pick', 'plane']] as const;

const next = (kind: SurfaceKind, waiting = false): SurfaceChoice => ({ kind, position: null, waiting });
const guard = (placed: SurfaceKind | null, n: SurfaceChoice, o: Partial<MoveGuard> = {}): MoveGuard =>
  ({ placed, next: n, stonesOn: 0, busy: false, seated: false, ...o });

describe('mayPlace', () => {
  it('(a) of the 36 pairs, only a lap tray or picked spot to a mesh or plane desk', () => {
    const yes: string[] = [];
    for (const a of KINDS) for (const b of KINDS) if (mayPlace(guard(a, next(b)))) yes.push(`${a}>${b}`);
    expect(yes.sort()).toEqual(['lap>mesh', 'lap>plane', 'pick>mesh', 'pick>plane']);
  });

  it('(b) a stone on the board, a stone in hand or moving, or a seated board each keeps it where it is', () => {
    for (const [a, b] of UPGRADES)
      for (const o of [{ stonesOn: 1 }, { busy: true }, { seated: true }])
        expect(mayPlace(guard(a, next(b), o)), `${a}>${b} ${JSON.stringify(o)}`).toBe(false);
  });

  it('(c) the first place: only once the chain stops waiting, stones or not', () => {
    expect(mayPlace(guard(null, next('mesh', true)))).toBe(false);
    for (const o of [{}, { stonesOn: 3 }, { busy: true }, { seated: true }, { stonesOn: 2, busy: true, seated: true }])
      expect(mayPlace(guard(null, next('lap'), o)), JSON.stringify(o)).toBe(true);
  });

  it('(d) a desk the chain still waits on does not move a lap tray', () => {
    expect(mayPlace(guard('lap', next('mesh', true)))).toBe(false);
    expect(mayPlace(guard('pick', next('plane', true)))).toBe(false);
  });
});

describe('stonesBusy', () => {
  it('(e) a stone held, on its way or falling', () => {
    expect(stonesBusy([])).toBe(false);
    expect(stonesBusy(['tray', 'placed'])).toBe(false);
    for (const m of ['held', 'tween', 'dynamic']) expect(stonesBusy([m]), m).toBe(true);
  });
});

describe('seatLatch', () => {
  it('(f) holds within a board, starts again with a new one', () => {
    expect(seatLatch({ gen: 1, seated: true }, 1, 0)).toEqual({ gen: 1, seated: true });
    expect(seatLatch({ gen: 1, seated: false }, 1, 1)).toEqual({ gen: 1, seated: true });
    expect(seatLatch({ gen: 1, seated: true }, 2, 0)).toEqual({ gen: 2, seated: false });
    expect(seatLatch({ gen: 1, seated: false }, 2, 1)).toEqual({ gen: 2, seated: true });
    const p = { gen: 1, seated: false };
    expect(seatLatch(p, 1, 1)).not.toBe(p);
    expect(p.seated).toBe(false);
  });
});

// (g) The chain as SurfaceSystem.update runs it (src/systems/surface.ts), one frame at a time at 72 Hz.
const DT = 1 / 72;
const HEAD = { x: 0, y: 1.15, z: 0.05 };
/** The table of the emulator's office_small room as the chain saw it (uretim/rapor/oda-masa-yeri.json). */
const TABLE = { x: 0.058, y: 0.745, z: -0.655, width: 1.6, depth: 0.754, yaw: 0.009, horizontal: true } as const;
const desk = (source: 'mesh' | 'plane'): SurfaceCandidate => ({ ...TABLE, source });

interface Timeline {
  hitTest: boolean;
  /** The desks the room reports at time t. */
  desks(t: number): SurfaceCandidate[];
  stonesOn?(t: number): number;
  busy?(t: number): boolean;
  gen?(t: number): number;
}

interface Run { placed: SurfaceKind | null; moves: number; hiddenUntil: number; at: Map<number, SurfaceKind | null> }

function run(tl: Timeline, until: number, probes: number[] = []): Run {
  let placed: SurfaceKind | null = null, moves = 0, hiddenUntil = 0;
  let latch: SeatLatch = { gen: -1, seated: false };
  const at = new Map<number, SurfaceKind | null>();
  let p = 0;
  const steps = Math.round(until / DT);
  for (let k = 1; k <= steps; k++) {
    const t = k * DT;
    while (p < probes.length && probes[p] <= t) at.set(probes[p++], placed);
    const on = tl.stonesOn?.(t) ?? 0;
    latch = seatLatch(latch, tl.gen?.(t) ?? 0, on);
    if (placed !== null && (on > 0 || latch.seated)) continue;
    const c = chooseSurface({
      inXR: true, passthrough: true, head: HEAD, fwd: { x: 0, z: -1 },
      candidates: tl.desks(t), hitTest: tl.hitTest, elapsed: t,
    });
    if (mayPlace({ placed, next: c, stonesOn: on, busy: tl.busy?.(t) ?? false, seated: latch.seated })) {
      if (placed !== null) moves++;
      placed = c.kind;
    } else if (placed === null && c.waiting) hiddenUntil = t;
  }
  while (p < probes.length) at.set(probes[p++], placed);
  return { placed, moves, hiddenUntil, at };
}

const from = (t0: number, d = desk('mesh')) => (t: number) => (t >= t0 ? [d] : []);

describe('(g) a desk found later, frame by frame', () => {
  it('hit-test, desk at 4 s: placed on it first, hidden until then', () => {
    const r = run({ hitTest: true, desks: from(4) }, 6);
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(0);
    expect(r.hiddenUntil).toBeGreaterThan(3.9);
    expect(r.hiddenUntil).toBeLessThan(4);
  });

  it('hit-test, desk at 12 s: lap tray at 9.5 s, then the desk', () => {
    const r = run({ hitTest: true, desks: from(12) }, 14, [9.4, 9.6, 11.9]);
    expect(r.at.get(9.4)).toBe(null);
    expect(r.at.get(9.6)).toBe('lap');
    expect(r.at.get(11.9)).toBe('lap');
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(1);
  });

  it('no hit-test, desk at 3 s: lap tray at 1.5 s, then the desk', () => {
    const r = run({ hitTest: false, desks: from(3) }, 5, [1.4, 1.6, 2.9]);
    expect(r.at.get(1.4)).toBe(null);
    expect(r.at.get(1.6)).toBe('lap');
    expect(r.at.get(2.9)).toBe('lap');
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(1);
  });

  it('a stone down at 11 s: the lap tray stays when the desk comes at 12 s', () => {
    const r = run({ hitTest: true, desks: from(12), stonesOn: t => (t >= 11 ? 1 : 0) }, 15);
    expect(r.placed).toBe('lap');
    expect(r.moves).toBe(0);
  });

  it('a stone down at 11 s and lifted off at 11.5 s: the lap tray stays', () => {
    const r = run({ hitTest: true, desks: from(12), stonesOn: t => (t >= 11 && t < 11.5 ? 1 : 0) }, 15);
    expect(r.placed).toBe('lap');
    expect(r.moves).toBe(0);
  });

  it('a stone in hand from 11 to 13 s: the desk at 12 s waits for it to be let go', () => {
    const r = run({ hitTest: true, desks: from(12), busy: t => t >= 11 && t < 13 }, 15, [12.9, 13.1]);
    expect(r.at.get(12.9)).toBe('lap');
    expect(r.at.get(13.1)).toBe('mesh');
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(1);
  });

  it('on the desk, the desk gone at 15 s: the board stays on it', () => {
    const r = run({ hitTest: false, desks: t => (t >= 3 && t < 15 ? [desk('mesh')] : []) }, 18);
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(1);
  });

  it('a plane desk at 3 s, the same desk as a mesh at 6 s: the plane stays', () => {
    const r = run({ hitTest: true, desks: t => (t >= 6 ? [desk('plane'), desk('mesh')] : t >= 3 ? [desk('plane')] : []) }, 8, [5.9]);
    expect(r.at.get(5.9)).toBe('plane');
    expect(r.placed).toBe('plane');
    expect(r.moves).toBe(0);
  });

  it('a stone at 11 s, a new board (rebuilt) at 11.5 s, the desk at 12 s: it moves', () => {
    const r = run({
      hitTest: true, desks: from(12),
      stonesOn: t => (t >= 11 && t < 11.5 ? 1 : 0), gen: t => (t >= 11.5 ? 1 : 0),
    }, 14);
    expect(r.placed).toBe('mesh');
    expect(r.moves).toBe(1);
  });
});

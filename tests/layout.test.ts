import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { buildArch, createLevel, placeStone, ringOrder } from '../src/game/arch-state.js';
import {
  abutments, ABUTMENT_HEIGHT, along, BOARD, CENTERING, centeringTop, markerSpots, MARKER, passengerPath, slotPose, stoneKind, stoneOutline, strikePull, trayPoses,
} from '../src/scene/layout.js';

describe.each(LEVELS.map(l => [l.id, l] as const))('layout %s', (_, def) => {
  const s0 = createLevel(def);

  it('every tray stone lies on the board, rows do not overlap, the centering stops short of them', () => {
    const poses = trayPoses(def);
    const spans: [number, number, number][] = []; // [zNear-arch, zNear-player, row key]
    def.tray.forEach((stone, i) => {
      const p = poses[i];
      expect(p.tilt).toBeCloseTo(-Math.PI / 2, 12);
      expect(p.y - def.depth / 2).toBeCloseTo(0, 12); // its back face rests on the board
      const o = stoneOutline(s0.geometry, stone);
      for (const v of o) expect(Math.abs(p.x + v.x)).toBeLessThanOrEqual(BOARD.width / 2);
      const z = o.map(v => p.z - v.y); // lying: local y points to -z
      spans.push([Math.min(...z), Math.max(...z), Math.round(p.z * 1e3)]);
      expect(Math.max(...z)).toBeLessThan(BOARD.zMax);
    });
    // Stones in different rows never share depth.
    for (const a of spans) for (const b of spans) {
      if (Math.abs(a[2] - b[2]) > 5) expect(a[1] < b[0] || b[1] < a[0]).toBe(true);
    }
    // The centering's handle at the end of its travel is still clear of the first row.
    const handleFront = def.depth / 2 + CENTERING.handleDepth + CENTERING.maxPull;
    expect(Math.min(...spans.map(s => s[0]))).toBeGreaterThan(handleFront);
    expect(CENTERING.maxPull).toBeGreaterThan(strikePull(def.depth));
  });

  it('the tray lies stones of one kind side by side, one run per kind, materials together', () => {
    const poses = trayPoses(def);
    const reading = def.tray.map((s, i) => ({ s, p: poses[i] }))
      .sort((a, b) => Math.round(a.p.z * 1e3) - Math.round(b.p.z * 1e3) || a.p.x - b.p.x);
    const runs: string[] = [];
    for (const { s } of reading) if (runs[runs.length - 1] !== stoneKind(s)) runs.push(stoneKind(s));
    expect(new Set(runs).size).toBe(runs.length);
    const mats = runs.map(k => k.split('|')[0]);
    const matRuns = mats.filter((m, i) => i === 0 || mats[i - 1] !== m);
    expect(new Set(matRuns).size).toBe(matRuns.length);
  });

  it('a seated stone is drawn exactly where the solver puts its block', () => {
    let s = s0;
    for (const step of def.solution) s = placeStone(s, step.stone, step.side);
    expect(s.error).toBeUndefined();
    const arch = buildArch(s);
    ringOrder(s).forEach((p, i) => {
      const pose = slotPose(s.geometry, p.stone, p.slot);
      const c = Math.cos(pose.angle), sn = Math.sin(pose.angle);
      for (const v of stoneOutline(s.geometry, p.stone)) {
        const x = pose.x + v.x * c - v.y * sn, y = pose.y + v.x * sn + v.y * c - ABUTMENT_HEIGHT;
        const d = Math.min(...arch.blocks[i].vertices.map(b => Math.hypot(b.x - x, b.y - y)));
        expect(d).toBeLessThan(1e-9);
      }
    });
  });

  it('the centering carries the keystone flat and never pokes through it (pointed or round)', () => {
    let s = s0;
    for (const step of def.solution) s = placeStone(s, step.stone, step.side);
    const key = ringOrder(s).find(p => p.stone.keystone)!;
    const under = buildArch(s).blocks[ringOrder(s).indexOf(key)].vertices.slice(0, 2); // inner edge
    const top = centeringTop(s.geometry, 32);
    for (const p of top) {
      if (p.x < under[0].x - 1e-9 || p.x > under[1].x + 1e-9) continue;
      const y = under[0].y + ((p.x - under[0].x) / (under[1].x - under[0].x)) * (under[1].y - under[0].y);
      expect(p.y).toBeLessThanOrEqual(y + 1e-9);
    }
    expect(top[0].x).toBeCloseTo(-def.span / 2, 12);
    expect(top[top.length - 1].x).toBeCloseTo(def.span / 2, 12);
  });

  it('the passenger walks from one abutment over the back of the arch to the other', () => {
    let s = s0;
    for (const step of def.solution) s = placeStone(s, step.stone, step.side);
    const path = passengerPath(def, s);
    const [l, r] = abutments(def);
    expect(path[0]).toEqual({ x: l.x - l.width / 2, y: ABUTMENT_HEIGHT });
    expect(path[path.length - 1]).toEqual({ x: r.x + r.width / 2, y: ABUTMENT_HEIGHT });
    // Over the keystone, not under it (a step up where a thicker stone follows a thinner one is fine).
    const top = Math.max(...path.map(p => p.y));
    expect(top).toBeGreaterThan(Math.max(...centeringTop(s.geometry, 32).map(p => p.y)) + ABUTMENT_HEIGHT + 0.005);
    expect(along(path, 0)).toEqual(path[0]);
    expect(along(path, 1).x).toBeCloseTo(path[path.length - 1].x, 12);
    expect(along(path, 0.5).x).toBeCloseTo(0, 6); // symmetric solution: half way is the crown
  });

  it('abutments carry the springings and fit on the board', () => {
    const [l, r] = abutments(def);
    expect(l.x + l.width / 2).toBeCloseTo(-def.span / 2, 9); // inner face at the springing
    expect(l.width).toBeGreaterThan(Math.max(...def.tray.map(t => t.t))); // wider than any stone's foot
    expect(r.x + r.width / 2).toBeLessThanOrEqual(BOARD.width / 2);
    expect(l.x - l.width / 2).toBeGreaterThanOrEqual(-BOARD.width / 2);
  });
});

describe('level markers', () => {
  const spots = markerSpots(LEVELS.map(l => l.id));
  it('one per level, beside the board, a column per world, never two in one place', () => {
    expect(spots.map(s => s.id)).toEqual(LEVELS.map(l => l.id));
    for (const s of spots) {
      expect(Math.abs(s.x) - MARKER.size / 2).toBeGreaterThan(BOARD.width / 2);
      expect(s.z).toBeGreaterThan(BOARD.zMin);
      expect(s.z).toBeLessThan(BOARD.zMax);
    }
    for (const a of spots) for (const b of spots) {
      if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(MARKER.size * 2);
    }
    const w1 = spots.filter(s => s.id.startsWith('w1-')), w2 = spots.filter(s => s.id.startsWith('w2-'));
    expect(new Set(w1.map(s => s.x)).size).toBe(1);
    expect(Math.sign(w1[0].x)).not.toBe(Math.sign(w2[0].x));
  });
});

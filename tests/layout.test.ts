import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { buildArch, createLevel, placeStone, ringOrder } from '../src/game/arch-state.js';
import {
  abutments, ABUTMENT_HEIGHT, BOARD, CENTERING, slotPose, stoneOutline, strikePull, trayPoses,
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

  it('abutments carry the springings and fit on the board', () => {
    const [l, r] = abutments(def);
    expect(l.x + l.width / 2).toBeCloseTo(-def.span / 2, 9); // inner face at the springing
    expect(l.width).toBeGreaterThan(Math.max(...def.tray.map(t => t.t))); // wider than any stone's foot
    expect(r.x + r.width / 2).toBeLessThanOrEqual(BOARD.width / 2);
    expect(l.x - l.width / 2).toBeGreaterThanOrEqual(-BOARD.width / 2);
  });
});

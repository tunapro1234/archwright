// Why a struck arch falls, as drawn (src/statics/failure-view.ts, failureMesh in src/scene/models.ts): the marks
// follow the solver's verdict, the line is dashed and thick where it leaves the stones, and it is one draw call.
import { describe, expect, it } from 'vitest';
import { semicircularArch, solveArch, type Arch, type SolveResult } from '../src/statics/index.js';
import {
  crackPath, DASH, failureMarks, failureStrokes, hingeEdge, inMasonry, jointOffset, STROKE,
} from '../src/statics/failure-view.js';
import { createLevel, placeStone, strike, buildArch } from '../src/game/arch-state.js';
import { LEVELS } from '../src/levels/index.js';
import { failureMesh } from '../src/scene/models.js';
import { HIGH_CONTRAST, PALETTE } from '../src/scene/palette.js';

const thick = semicircularArch({ R: 1, t: 0.2, n: 9 });
const thin = semicircularArch({ R: 1, t: 0.09, n: 12 }); // below Heyman's 0.107: four hinges

describe('failureMarks', () => {
  it('a standing arch has no marks', () => {
    const r = solveArch(thick);
    expect(r.stands).toBe(true);
    expect(failureMarks(r, thick)).toEqual({ kind: 'none', line: null, outside: [], joints: [] });
  });

  it('a hinge: the line, a point per joint, leaves the masonry at the outside joints; the joints are the critical ones', () => {
    const r = solveArch(thin);
    const m = failureMarks(r, thin);
    expect(m.kind).toBe('hinge');
    expect(m.line).toHaveLength(thin.joints.length);
    expect(m.joints).toEqual(r.criticalJoints);
    expect(m.outside.length).toBeGreaterThan(0);
    for (const j of m.outside) {
      const { e, h } = jointOffset(thin, j, m.line![j]);
      expect(Math.abs(e)).toBeGreaterThanOrEqual(h - 1e-6);
    }
    // ...and only those: every other joint point lies inside its joint.
    m.line!.forEach((p, j) => {
      if (!m.outside.includes(j)) expect(Math.abs(jointOffset(thin, j, p).e)).toBeLessThan(jointOffset(thin, j, p).h);
    });
  });

  it('sliding keeps the line (the friction it would need), naming the joints that slip', () => {
    const r = solveArch(thick, { friction: 0.1 });
    expect(r.failure).toBe('sliding');
    const m = failureMarks(r, thick);
    expect(m.kind).toBe('sliding');
    expect(m.line).toHaveLength(thick.joints.length);
    expect(m.joints).toEqual(r.criticalJoints);
  });

  it('tension: no line can be drawn, only the joints that would have to pull', () => {
    const r = solveArch(thick, { pointLoads: [{ at: { x: 0, y: 1 }, fy: 2e5 }] });
    expect(r.failure).toBe('tension');
    const m = failureMarks(r, thick);
    expect(m).toEqual({ kind: 'tension', line: null, outside: [], joints: r.criticalJoints });
  });

  it('a hinge the rounding hides still names the worst joint (never seen on a level; shown here on a made-up result)', () => {
    const r = solveArch(thick);
    const fake: SolveResult = { ...r, stands: false, failure: 'hinge' };
    const m = failureMarks(fake, thick);
    const ratios = r.thrustLine.map((p, j) => { const o = jointOffset(thick, j, p); return Math.abs(o.e) / o.h; });
    expect(m.outside).toEqual([ratios.indexOf(Math.max(...ratios))]);
  });

  it('no failure field means a hinge; a line of the wrong length (an open arch) is not drawn', () => {
    const r: SolveResult = { stands: false, thrustLine: [], minMargin: -1, criticalJoints: [] };
    expect(failureMarks(r, thick)).toEqual({ kind: 'hinge', line: null, outside: [], joints: [] });
  });

  it('every level: the solution has no marks, the trap shows where it breaks (README: 4 to 8 joints, all hinges)', () => {
    const counts: number[] = [];
    for (const def of LEVELS) {
      for (const [steps, holds] of [[def.solution, true], [def.trap, false]] as const) {
        let s = createLevel(def);
        for (const st of steps) s = placeStone(s, st.stone, st.side);
        const { state, result } = strike(s);
        const m = failureMarks(result, buildArch(state));
        if (holds) expect(m.kind, def.id).toBe('none');
        else {
          expect(m.kind, def.id).toBe(result.failure ?? 'hinge');
          expect(m.joints, def.id).toEqual(result.criticalJoints);
          expect(m.kind, def.id).toBe('hinge');
          expect(m.outside.length, def.id).toBeGreaterThan(0);
          counts.push(m.outside.length);
        }
      }
    }
    expect(counts).toHaveLength(17);
    expect([Math.min(...counts), Math.max(...counts)]).toEqual([4, 8]);
  });

  it('does not change its input', () => {
    const r = solveArch(thin);
    const copy = JSON.parse(JSON.stringify(r));
    const m = failureMarks(r, thin);
    m.line![0].x += 1; m.joints.push(99);
    expect(r).toEqual(copy);
  });
});

describe('failureStrokes', () => {
  const r = solveArch(thin);
  const m = failureMarks(r, thin);
  const strokes = failureStrokes(m, thin);
  const cracks = strokes.filter(s => s.radius.every(v => v === STROKE.crack));
  const rings = strokes.filter(s => s.radius.every(v => v === STROKE.ring));
  const dashes = strokes.filter(s => s.radius.some(v => v === STROKE.line || v === STROKE.outside));

  it('one crack per critical joint, running end to end along it', () => {
    expect(cracks).toHaveLength(m.joints.length);
    m.joints.forEach((j, i) => {
      const [a, b] = thin.joints[j];
      expect(cracks[i].points[0]).toEqual(a);
      expect(cracks[i].points.at(-1)).toEqual(b);
      expect(cracks[i].points).toEqual(crackPath(thin, j));
    });
  });

  it('one ring per outside joint, round the joint end on the line\'s side', () => {
    expect(rings).toHaveLength(m.outside.length);
    m.outside.forEach((j, i) => {
      const c = hingeEdge(thin, j, m.line![j]);
      for (const p of rings[i].points) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(STROKE.ringRadius, 9);
      // The end the line passes: further along the joint than the line point's eccentricity sign says.
      const { e } = jointOffset(thin, j, m.line![j]);
      expect(c).toEqual(e >= 0 ? thin.joints[j][1] : thin.joints[j][0]);
    });
  });

  it('the line is dashed: gaps between pieces, no piece longer than a dash', () => {
    expect(dashes.length).toBeGreaterThan(10);
    for (const d of dashes) {
      let len = 0;
      for (let i = 1; i < d.points.length; i++) len += Math.hypot(d.points[i].x - d.points[i - 1].x, d.points[i].y - d.points[i - 1].y);
      expect(len).toBeLessThanOrEqual(DASH.on + 1e-9);
    }
  });

  it('thick exactly where the line is out of the stones, thin inside them', () => {
    let thickN = 0, thinN = 0;
    for (const d of dashes) d.points.forEach((p, i) => {
      if (d.radius[i] === STROKE.outside) { thickN++; expect(inMasonry(thin, p, 1e-12)).toBe(false); }
      else { thinN++; expect(inMasonry(thin, p, 1e-12)).toBe(true); }
    });
    expect(thickN).toBeGreaterThan(0);
    expect(thinN).toBeGreaterThan(0);
  });

  it('nothing to draw for a standing arch; only cracks for tension', () => {
    expect(failureStrokes(failureMarks(solveArch(thick), thick), thick)).toEqual([]);
    const t = failureMarks(solveArch(thick, { pointLoads: [{ at: { x: 0, y: 1 }, fy: 2e5 }] }), thick);
    const s = failureStrokes(t, thick);
    expect(s).toHaveLength(t.joints.length);
    expect(s.every(x => x.radius.every(v => v === STROKE.crack))).toBe(true);
  });
});

describe('inMasonry', () => {
  const arch: Arch = thick;
  it('the middle of a block is in, the centre of the arch and a point above it are out', () => {
    const v = arch.blocks[4].vertices;
    const c = { x: v.reduce((s, p) => s + p.x, 0) / v.length, y: v.reduce((s, p) => s + p.y, 0) / v.length };
    expect(inMasonry(arch, c)).toBe(true);
    expect(inMasonry(arch, { x: 0, y: 0.5 })).toBe(false);
    expect(inMasonry(arch, { x: 0, y: 1.5 })).toBe(false);
  });
});

describe('failureMesh', () => {
  const m = failureMarks(solveArch(thin), thin);
  const strokes = failureStrokes(m, thin);
  const mesh = failureMesh(strokes, 0.05);

  it('one mesh, one material in the failure colour, invisible until faded in', () => {
    expect(mesh.name).toBe('failure-marks');
    expect(mesh.children).toHaveLength(0);
    const mat = mesh.material as { color: { getHex(): number }; opacity: number; transparent: boolean };
    expect(mat.color.getHex()).toBe(PALETTE.thrustFail);
    expect(mat.opacity).toBe(0);
    expect(mat.transparent).toBe(true);
  });

  it('a six-sided tube round every stroke point, in front of the stones, wound outwards', () => {
    const pos = mesh.geometry.getAttribute('position');
    expect(pos.count).toBe(6 * strokes.reduce((s, x) => s + x.points.length, 0));
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getZ(i) - 0.05)).toBeLessThanOrEqual(STROKE.outside + 1e-6);
    // Every triangle's normal points away from the stroke's axis (the line through its points at z = 0.05).
    const idx = mesh.geometry.getIndex()!;
    const p = (k: number) => [pos.getX(k), pos.getY(k), pos.getZ(k)];
    for (let t = 0; t < Math.min(idx.count, 600); t += 3) {
      const [a, b, c] = [p(idx.getX(t)), p(idx.getX(t + 1)), p(idx.getX(t + 2))];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      // The z part of the normal agrees with the side of the axis the triangle is on.
      const zc = (a[2] + b[2] + c[2]) / 3 - 0.05;
      if (Math.abs(zc) > 1e-4) expect(Math.sign(n[2])).toBe(Math.sign(zc));
    }
  });

  it('the high-contrast palette has its own failure colour, apart from its line of thrust', () => {
    expect(HIGH_CONTRAST.thrustFail).not.toBe(HIGH_CONTRAST.thrust);
    expect(PALETTE.thrustFail).not.toBe(PALETTE.thrust);
  });
});

import { describe, expect, it } from 'vitest';
import { pointedArch, semicircularArch, solveArch, type Arch, type Vec2 } from '../src/statics/index.js';

const P = (x: number, y: number): Vec2 => ({ x, y });
const single = (vertices: Vec2[], left: [Vec2, Vec2], right: [Vec2, Vec2]): Arch => ({
  blocks: [{ vertices }],
  joints: [left, right],
  depth: 0.1,
});

/** Point p lies on segment ab (within 1e-9). */
function onSegment(p: Vec2, [a, b]: [Vec2, Vec2]): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  return t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < 1e-9;
}

function signedArea(v: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < v.length; i++) a += v[i].x * v[(i + 1) % v.length].y - v[(i + 1) % v.length].x * v[i].y;
  return a / 2;
}

function isConvexCCW(v: Vec2[]): boolean {
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length], c = v[(i + 2) % v.length];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return false;
  }
  return true;
}

describe('single block', () => {
  // A keystone-shaped wedge (wider on top) between two inclined abutment faces.
  const wedge = single([P(-0.05, 0), P(0.05, 0), P(0.08, 0.1), P(-0.08, 0.1)], [P(-0.05, 0), P(-0.08, 0.1)], [P(0.05, 0), P(0.08, 0.1)]);
  // The same block cut square: vertical faces can only hold it by friction.
  const square = single([P(-0.05, 0), P(0.05, 0), P(0.05, 0.1), P(-0.05, 0.1)], [P(-0.05, 0), P(-0.05, 0.1)], [P(0.05, 0), P(0.05, 0.1)]);
  // Upside-down wedge: faces lean outwards by atan(0.3), so it needs friction above 0.3
  // (approached as the clamping force grows, never reached).
  const inverted = single([P(-0.08, 0), P(0.08, 0), P(0.05, 0.1), P(-0.05, 0.1)], [P(-0.08, 0), P(-0.05, 0.1)], [P(0.08, 0), P(0.05, 0.1)]);

  it('a wedge stands by its shape alone, even on frictionless faces', () => {
    const r = solveArch(wedge, { friction: 0 });
    expect(r.stands).toBe(true);
    expect(r.minMargin).toBeGreaterThan(0.9); // thrust can pass through both joint centres
    r.thrustLine.forEach((p, i) => expect(onSegment(p, wedge.joints[i])).toBe(true));
  });

  it('a square block between vertical faces slides without friction and stands with it', () => {
    const slip = solveArch(square, { friction: 0 });
    expect(slip.stands).toBe(false);
    expect(slip.failure).toBe('sliding');
    expect(slip.minMargin).toBeLessThanOrEqual(0);
    expect(slip.criticalJoints).toEqual([0, 1]);
    expect(solveArch(square, { friction: 0.7 }).stands).toBe(true);
  });

  it('an inverted wedge needs friction just above tan(theta) = 0.3', () => {
    const below = solveArch(inverted, { friction: 0.29 });
    expect(below.stands).toBe(false);
    expect(below.failure).toBe('sliding');
    // minMargin = mu / mu_needed - 1
    const needed = 0.29 / (1 + below.minMargin);
    expect(needed).toBeGreaterThan(0.3);
    expect(needed).toBeLessThan(0.302);
    expect(solveArch(inverted, { friction: 0.31 }).stands).toBe(true);
  });
});

describe('two blocks', () => {
  // Two slabs leaning on each other at 60 degrees: horizontal feet, vertical joint at the apex.
  function leaning(t: number): Arch {
    const c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3);
    const P0 = P(-0.3, 0), P1 = P(-0.3 + t / s, 0);
    const Q0 = P(0, (0.3 / c) * s), Q1 = P(0, ((0.3 - t / s) / c) * s);
    const m = (p: Vec2) => P(-p.x, p.y);
    return {
      blocks: [{ vertices: [P0, P1, Q1, Q0] }, { vertices: [m(Q0), m(Q1), m(P1), m(P0)] }],
      joints: [[P0, P1], [Q1, Q0], [m(P1), m(P0)]],
      depth: 0.1,
    };
  }

  it('stand on a grippy floor, with the thrust line inside all three joints', () => {
    const a = leaning(0.05);
    const r = solveArch(a, { friction: 0.7 });
    expect(r.stands).toBe(true);
    expect(r.thrustLine).toHaveLength(3);
    r.thrustLine.forEach((p, i) => expect(onSegment(p, a.joints[i])).toBe(true));
  });

  it('slide apart on a slippery floor, at the feet', () => {
    const r = solveArch(leaning(0.05), { friction: 0.1 });
    expect(r.stands).toBe(false);
    expect(r.failure).toBe('sliding');
    expect(r.criticalJoints).toEqual([0, 2]);
  });
});

describe('semicircular arch', () => {
  it('collapses by a five-hinge-style mechanism through springings, haunches and crown', () => {
    const r = solveArch(semicircularArch({ R: 1, t: 0.05, n: 24 }), { friction: 0.8 });
    expect(r.failure).toBe('hinge');
    expect(r.criticalJoints).toContain(0);
    expect(r.criticalJoints).toContain(12);
    expect(r.criticalJoints).toContain(24);
  });

  it('puts a point load on the block that contains it', () => {
    const a = semicircularArch({ R: 1, t: 0.15, n: 24, depth: 0.3 });
    const W = Math.PI * 0.15 * 0.3 * 2200 * 9.81;
    const haunch = { x: Math.cos((3 * Math.PI) / 4), y: Math.sin((3 * Math.PI) / 4) };
    const free = solveArch(a);
    const loaded = solveArch(a, { pointLoads: [{ at: haunch, fy: -0.2 * W }] });
    expect(loaded.minMargin).toBeLessThan(free.minMargin);
    // A load just outside the ring is handed to the nearest block, not dropped.
    const outside = { x: haunch.x * 1.1, y: haunch.y * 1.1 };
    expect(solveArch(a, { friction: 0.8, pointLoads: [{ at: outside, fy: -3 * W }] }).stands).toBe(false);
  });
});

describe('pointedArch', () => {
  it('reduces to the semicircle when rise = span / 2', () => {
    const a = pointedArch(2, 1, 0.12, 18);
    const b = semicircularArch({ R: 1, t: 0.12, n: 18 });
    a.joints.forEach(([p, q], i) => {
      expect(p.x).toBeCloseTo(b.joints[i][0].x, 12);
      expect(p.y).toBeCloseTo(b.joints[i][0].y, 12);
      expect(q.x).toBeCloseTo(b.joints[i][1].x, 12);
      expect(q.y).toBeCloseTo(b.joints[i][1].y, 12);
    });
  });

  it('accepts positional and object arguments alike', () => {
    expect(pointedArch(3, 2, 0.2, 13, 0.4)).toEqual(pointedArch({ span: 3, rise: 2, t: 0.2, n: 13, depth: 0.4 }));
  });

  it.each([16, 17])('has n convex CCW blocks, horizontal springings and a vertical crown joint (n=%i)', n => {
    const a = pointedArch(2, 1.5, 0.1, n);
    expect(a.blocks).toHaveLength(n);
    expect(a.joints).toHaveLength(n + 1);
    for (const b of a.blocks) {
      expect(signedArea(b.vertices)).toBeGreaterThan(0);
      expect(isConvexCCW(b.vertices)).toBe(true);
    }
    for (const j of [a.joints[0], a.joints[n]]) for (const p of j) expect(p.y).toBe(0);
    expect(Math.min(...a.joints[0].map(p => p.x))).toBeCloseTo(-1.05, 12);
    expect(Math.max(...a.joints[n].map(p => p.x))).toBeCloseTo(1.05, 12);
    if (n % 2 === 0) {
      const [p, q] = a.joints[n / 2];
      expect(p.x).toBe(0);
      expect(q.x).toBe(0);
      // The centre line passes through the apex at (0, rise).
      expect((p.y + q.y) / 2).toBeCloseTo(1.5, 2);
    }
  });

  it('is mirror-symmetric', () => {
    const a = pointedArch(2, 1.4, 0.1, 20);
    for (let j = 0; j <= 20; j++) {
      const [p, q] = a.joints[j];
      const [p2, q2] = a.joints[20 - j];
      expect(p.x).toBeCloseTo(-p2.x, 12);
      expect(p.y).toBeCloseTo(p2.y, 12);
      expect(q.x).toBeCloseTo(-q2.x, 12);
      expect(q.y).toBeCloseTo(q2.y, 12);
    }
  });

  it('stands at a thickness where the semicircle of the same span falls', () => {
    const opts = { friction: 0.8 };
    expect(solveArch(semicircularArch({ R: 1, t: 0.09, n: 36 }), opts).stands).toBe(false);
    const r = solveArch(pointedArch(2, 1.5, 0.09, 36), opts);
    expect(r.stands).toBe(true);
    expect(r.minMargin).toBeGreaterThan(0);
  });

  it('rejects a rise below half the span', () => {
    expect(() => pointedArch(2, 0.8, 0.1, 10)).toThrow();
  });
});

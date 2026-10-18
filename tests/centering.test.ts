// The centering as an open timber frame (centeringMesh, src/scene/models.ts): on every level it is one
// geometry, its laths carry the stones on the intrados, it stands on the board, and from the front most
// of what used to be a solid board is now open.
import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Vector3 } from '@iwsdk/core';
import { CENTERING_FRAME, centeringMesh, offsetInward } from '../src/scene/models.js';
import { ABUTMENT_HEIGHT, CENTERING, centeringTop } from '../src/scene/layout.js';
import { createLevel } from '../src/game/arch-state.js';
import { LEVELS } from '../src/levels/index.js';
import type { Vec2 } from '../src/statics/index.js';

/** Area of the faces looking at +z (the front), and of the solid board the frame replaces. */
function frontFill(top: Vec2[], geo: ReturnType<typeof centeringMesh>['geometry']): { front: number; solid: number } {
  const pos = geo.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3();
  let front = 0;
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.z > 0 && n.z / n.length() > 0.9) front += n.z / 2;
  }
  const half = top[top.length - 1].x;
  const poly = [{ x: half, y: -ABUTMENT_HEIGHT }, ...[...top].reverse(), { x: -half, y: -ABUTMENT_HEIGHT }];
  let solid = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; solid += p.x * q.y - q.x * p.y; }
  return { front, solid: Math.abs(solid) / 2 };
}

/** Distance from `p` to the polyline `pts`. */
function toCurve(pts: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

describe('centeringMesh: an open frame on every level', () => {
  const mat = new MeshStandardMaterial();
  for (const def of LEVELS) {
    const top = centeringTop(createLevel(def).geometry, 32);
    const mesh = centeringMesh(top, def.depth, mat);
    const geo = mesh.geometry;

    it(`${def.id}: one geometry, the handle where it always was`, () => {
      expect(mesh.name).toBe('centering');
      let n = 0;
      mesh.traverse(o => { if ((o as { isMesh?: boolean }).isMesh && o.name !== 'centering-handle') n++; });
      expect(n).toBe(1);
      const h = mesh.getObjectByName('centering-handle')!;
      const d = def.depth * 0.92;
      expect(h.position.toArray()).toEqual([0, -ABUTMENT_HEIGHT + 0.022, d / 2 + CENTERING.handleDepth / 2]);
    });

    it(`${def.id}: from the front it fills 8 to 40% of the solid board, and stays within its outline`, () => {
      const { front, solid } = frontFill(top, geo);
      expect(front / solid).toBeGreaterThanOrEqual(0.08);
      expect(front / solid).toBeLessThanOrEqual(0.4);
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      expect(bb.min.y).toBeCloseTo(-ABUTMENT_HEIGHT, 6); // positions are float32
      expect(bb.max.y).toBeLessThanOrEqual(Math.max(...top.map(p => p.y)) + 1e-6);
      expect(bb.max.x).toBeLessThanOrEqual(top[top.length - 1].x + 1e-6);
      expect(bb.min.x).toBeGreaterThanOrEqual(top[0].x - 1e-6);
      expect(bb.max.z - bb.min.z).toBeCloseTo(def.depth * 0.92, 6);
    });

    it(`${def.id}: the stones rest on the laths, a millimetre or two under the intrados and never above it`, () => {
      // The highest points of the frame along its length (the laths' top corners) lie on the curve, inset.
      const pos = geo.getAttribute('position');
      const tops: Vec2[] = [];
      for (let i = 0; i < pos.count; i++) {
        const p = { x: pos.getX(i), y: pos.getY(i) };
        if (p.y > -1e-6 && toCurve(top, p) < 0.0025) tops.push(p);
      }
      expect(tops.length).toBeGreaterThan(20);
      // Every vertex of the frame is on or under the intrados.
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const k = top.findIndex(p => p.x >= x);
        if (k <= 0) continue;
        const a = top[k - 1], b = top[k];
        const yc = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
        expect(y).toBeLessThanOrEqual(yc + 1e-6);
      }
    });

    it(`${def.id}: few triangles`, () => {
      expect(geo.getAttribute('position').count / 3).toBeLessThan(2000);
    });
  }
});

/** Do segments ab and cd cross (not counting shared end points)? */
function cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < -1e-15 && o(c, d, a) * o(c, d, b) < -1e-15;
}

describe('centering ribs: the offset lines under the laths', () => {
  const F = CENTERING_FRAME;
  for (const def of LEVELS) {
    it(`${def.id}: both rib lines run left to right, keep their distance from the intrados and the rib does not cross itself`, () => {
      const top = centeringTop(createLevel(def).geometry, 32);
      const ribTop = offsetInward(top, F.lathThick), ribBottom = offsetInward(top, F.lathThick + F.rib);
      for (const [line, by] of [[ribTop, F.lathThick], [ribBottom, F.lathThick + F.rib]] as const) {
        for (let i = 1; i < line.length; i++) expect(line[i].x).toBeGreaterThan(line[i - 1].x);
        // Where a curve segment is shorter than the offset (a pointed crown's keystone corners), the corner that would
        // run backwards is dropped and the line there sits up to ~1 mm nearer the intrados (w2-2: 15.1 of 16 mm).
        for (const p of line) expect(toCurve(top, p)).toBeGreaterThan(by * 0.9);
      }
      const rib = [...ribTop, ...[...ribBottom].reverse()];
      for (let i = 0; i < rib.length; i++) for (let j = i + 2; j < rib.length; j++) {
        if (i === 0 && j === rib.length - 1) continue; // the closing edge meets the first
        expect(cross(rib[i], rib[(i + 1) % rib.length], rib[j], rib[(j + 1) % rib.length])).toBe(false);
      }
    });
  }
});

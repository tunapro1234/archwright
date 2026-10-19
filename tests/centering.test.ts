// The centering as an open timber frame (centeringMesh, src/scene/models.ts): on every level it is one
// geometry, its laths carry the stones on the intrados, it stands on the board, and from the front most
// of what used to be a solid board is now open: ribs carry the look, the laths are sparse slats.
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

/** Share of the solid board's outline the frame covers seen from the front: its faces looking at +z drawn onto a grid
 *  of `cell` (m) and counted once, so a face behind another (the back rib behind the front one) adds nothing. */
function frontCover(top: Vec2[], geo: ReturnType<typeof centeringMesh>['geometry'], cell = 0.0005): number {
  const half = top[top.length - 1].x, yTop = Math.max(...top.map(p => p.y));
  const nx = Math.ceil((2 * half) / cell), ny = Math.ceil((yTop + ABUTMENT_HEIGHT) / cell);
  const hit = new Uint8Array(nx * ny);
  const pos = geo.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e = new Vector3();
  const side = (p: Vector3, q: Vector3, x: number, y: number) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    if (!(n.z > 0 && n.z / n.length() > 0.9)) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) + half) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) + half) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) + ABUTMENT_HEIGHT) / cell)), j1 = Math.min(ny - 1, Math.floor((Math.max(a.y, b.y, c.y) + ABUTMENT_HEIGHT) / cell));
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) {
      const x = -half + (k + 0.5) * cell, y = -ABUTMENT_HEIGHT + (j + 0.5) * cell;
      if (side(a, b, x, y) >= 0 && side(b, c, x, y) >= 0 && side(c, a, x, y) >= 0) hit[j * nx + k] = 1;
    }
  }
  let covered = 0;
  for (const h of hit) covered += h;
  return (covered * cell * cell) / frontFill(top, geo).solid;
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

    it(`${def.id}: seen from the front it covers 8 to 20% of the solid board, and stays within its outline`, () => {
      const cover = frontCover(top, geo);
      expect(cover).toBeGreaterThanOrEqual(0.08);
      expect(cover).toBeLessThanOrEqual(0.2);
      // Every face looking forward, the hidden back rib's too: still under 40% (the measure of the frame's first test).
      const { front, solid } = frontFill(top, geo);
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
        // The left-to-right check above only sees what the filter kept: it may drop at most two corners, and never an
        // end, so the rib still reaches both springings, each end offset square to its own segment.
        expect(top.length - line.length).toBeLessThanOrEqual(2);
        for (const [p, a, b] of [[line[0], top[0], top[1]], [line[line.length - 1], top[top.length - 2], top[top.length - 1]]]) {
          const len = Math.hypot(b.x - a.x, b.y - a.y), end = p === line[0] ? a : b;
          expect(p.x).toBeCloseTo(end.x + ((b.y - a.y) / len) * by, 9);
          expect(p.y).toBeCloseTo(end.y - ((b.x - a.x) / len) * by, 9);
        }
      }
      const rib = [...ribTop, ...[...ribBottom].reverse()];
      for (let i = 0; i < rib.length; i++) for (let j = i + 2; j < rib.length; j++) {
        if (i === 0 && j === rib.length - 1) continue; // the closing edge meets the first
        expect(cross(rib[i], rib[(i + 1) % rib.length], rib[j], rib[(j + 1) % rib.length])).toBe(false);
      }
    });
  }
});

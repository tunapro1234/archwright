import { describe, expect, it } from 'vitest';
import {
  loadHandles, MAX_PLINTHS, miniature, MUSEUM_KEY, museumPieces, PLINTH, plinthLayout, saveHandles,
} from '../src/game/museum.js';
import { emptyProgress, encodeArch, recordWin, type ProgressStorage } from '../src/game/progress.js';
import { LEVELS } from '../src/levels/index.js';
import { A11Y_PANEL, BOARD, dailySpot, loadRest, MARKER, markerSpots } from '../src/scene/layout.js';
import { ATELIER_DESK } from '../src/scene/models.js';

const ids = LEVELS.map(l => l.id);
const solveAll = (list: string[]) => list.reduce((p, id) => recordWin(p, id, 7, '2026-10-20'), emptyProgress());
const memory = (): ProgressStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('museum pieces', () => {
  it('a plinth per finished world, with the best count on its last level', () => {
    const p = recordWin(solveAll(ids), 'w1-5', 6, '2026-10-21');
    const m = museumPieces(p);
    expect(m[0]).toEqual({ id: 'world:w1', levelId: 'w1-5', stones: 6, slot: 0 });
    expect(m.map(x => x.slot)).toEqual(m.map((_, i) => i));
    expect(m.length).toBeLessThanOrEqual(MAX_PLINTHS);
  });

  it('a daily win does not count, and odd saves read as an empty museum', () => {
    expect(museumPieces(recordWin(emptyProgress(), 'daily-2026-10-12', 5, '2026-10-12'))).toEqual([]);
    for (const bad of [null, {}, { solved: null }, { solved: 3 }]) expect(museumPieces(bad as never)).toEqual([]);
  });
});

describe('plinth layout', () => {
  const L = plinthLayout(MAX_PLINTHS);
  const half = PLINTH.size / 2;

  it('asking for more than eight still gives eight', () => {
    expect(plinthLayout(20)).toEqual(L);
  });

  it('every plinth clears the markers, the daily marker, the panel and the loads waiting behind the arch', () => {
    const marks = [...markerSpots(ids), { id: 'today', ...dailySpot(ids) }];
    for (const p of L) {
      for (const s of marks) {
        const dx = Math.max(Math.abs(s.x - p.x) - half, 0), dz = Math.max(Math.abs(s.z - p.z) - half, 0);
        expect(Math.hypot(dx, dz), s.id).toBeGreaterThanOrEqual(MARKER.size);
      }
      const px = Math.max(Math.abs(p.x - A11Y_PANEL.x) - half - A11Y_PANEL.width / 2, 0);
      const pz = Math.max(Math.abs(p.z - A11Y_PANEL.z) - half - A11Y_PANEL.depth / 2, 0);
      expect(Math.hypot(px, pz)).toBeGreaterThan(0.1);
      for (const def of LEVELS) for (const l of def.loads ?? []) {
        const r = loadRest({ span: def.span, rise: def.rise, units: def.stones, depth: def.depth }, l.course);
        expect(p.z + half).toBeLessThan(r.z - 0.02);
      }
    }
  });

  it('plinths do not touch each other, and stand on the virtual desks', () => {
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      expect(Math.max(Math.abs(L[i].x - L[j].x), Math.abs(L[i].z - L[j].z))).toBeGreaterThan(PLINTH.size + 0.02);
    }
    // Atelier desk: centre 5 cm behind the arch (SurfaceSystem). Page desk (outside XR): 1.3 x 0.7 m,
    // centre 5 cm in front of the arch, so its back edge is 30 cm behind it.
    for (const { x, z } of L) {
      expect(Math.abs(x) + half).toBeLessThanOrEqual(ATELIER_DESK.width / 2);
      expect(z - half).toBeGreaterThanOrEqual(Math.max(-0.05 - ATELIER_DESK.depth / 2, 0.05 - 0.35));
      expect(z).toBeLessThan(BOARD.zMin);
    }
  });
});

describe('the copy on a plinth', () => {
  it.each(ids.filter(id => /^w\d+-5$/.test(id)))('%s fits on the plinth top and holds the whole solution', id => {
    const def = LEVELS.find(l => l.id === id)!;
    const m = miniature(def);
    expect(m.stones.length).toBe(def.solution.length);
    const [l, r] = m.piers;
    expect((r.x + r.width / 2 - (l.x - l.width / 2)) * m.scale).toBeLessThanOrEqual(PLINTH.size);
    expect(def.depth * m.scale).toBeLessThan(PLINTH.size);
  });
});

describe("the player's own arch", () => {
  const def = LEVELS.find(l => l.id === 'w1-5')!;
  const ownSteps = [...def.trap];

  it('a piece carries the arrangement saved with the win, and the copy is built from it', () => {
    const p = recordWin(solveAll(ids.filter(id => id !== 'w1-5')), 'w1-5', ownSteps.length, 'd', ownSteps);
    const piece = museumPieces(p)[0];
    expect(piece.arch).toBe(encodeArch('w1-5', ownSteps));
    const m = miniature(def, piece.arch);
    expect(m.own).toBe(true);
    expect(m.stones.map(s => s.stone.id)).toEqual(ownSteps.map(s => s.stone));
  });

  it('no arrangement, or one that does not close the arch here: the reference solution', () => {
    for (const arch of [undefined, '', '0l', '0l,99r']) {
      const m = miniature(def, arch);
      expect(m.own).toBe(false);
      expect(m.stones.map(s => s.stone.id)).toEqual(def.solution.map(s => s.stone));
    }
  });
});

describe('anchor handles', () => {
  it('round-trip; anything odd in the save is dropped, never thrown', () => {
    const s = memory();
    expect(saveHandles(s, { 'world:w1': 'a1b2', 'world:w2': 'c3' })).toBe(true);
    expect(loadHandles(s)).toEqual({ 'world:w1': 'a1b2', 'world:w2': 'c3' });
    s.data.set(MUSEUM_KEY, JSON.stringify({ handles: { 'world:w1': 5, junk: 'x', 'world:w3': '' } }));
    expect(loadHandles(s)).toEqual({});
    for (const bad of ['{', 'null', '[]', '"x"']) { s.data.set(MUSEUM_KEY, bad); expect(loadHandles(s)).toEqual({}); }
    expect(loadHandles(null)).toEqual({});
    expect(saveHandles(null, {})).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(loadHandles(broken)).toEqual({});
    expect(saveHandles(broken, {})).toBe(false);
  });
});

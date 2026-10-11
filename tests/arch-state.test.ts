import { describe, expect, it } from 'vitest';
import {
  buildArch, createLevel, isClosed, openFaces, placeStone, ringOrder, strike, takeBack, type LevelDef, type StoneDef,
} from '../src/game/arch-state.js';
import { ringArch, semicircularArch, solveArch } from '../src/statics/index.js';

const stone = (id: string, t: number, extra: Partial<StoneDef> = {}): StoneDef => ({ id, material: 'sandstone', t, units: 1, ...extra });
// Seven courses: a half holds at most 3; the keystone takes the last course at the crown.
const def: LevelDef = {
  id: 'test',
  span: 0.3,
  rise: 0.15,
  stones: 7,
  depth: 0.06,
  tray: [
    stone('a', 0.024), stone('b', 0.024), stone('c', 0.024), stone('d', 0.024),
    stone('w', 0.024, { units: 2 }), stone('thin', 0.01, { material: 'tuff' }),
    stone('key', 0.024, { keystone: true }),
  ],
  solution: [],
  trap: [],
  par: 0,
};

describe('placing stones', () => {
  it('grows each half from its own abutment', () => {
    let s = createLevel(def);
    expect(openFaces(s)).toEqual([{ side: 'left', slot: 0 }, { side: 'right', slot: 6 }]);
    s = placeStone(s, 'a', 'left');
    s = placeStone(s, 'w', 'right');
    expect(s.error).toBeUndefined();
    expect(s.placed.map(p => [p.stone.id, p.slot])).toEqual([['a', 0], ['w', 5]]);
    expect(openFaces(s)).toEqual([{ side: 'left', slot: 1 }, { side: 'right', slot: 4 }]);
    expect(s.tray.map(t => t.id)).toEqual(['b', 'c', 'd', 'thin', 'key']);
  });

  it('never mutates the state it was given', () => {
    const s = createLevel(def);
    const copy = structuredClone(s);
    placeStone(s, 'a', 'left');
    expect(s).toEqual(copy);
  });

  it('refuses a stone that is not in the tray, leaving the state as it was', () => {
    const s = placeStone(createLevel(def), 'a', 'left');
    const again = placeStone(s, 'a', 'right');
    expect(again.error).toMatch(/not in the tray/);
    expect(again.placed).toBe(s.placed);
    expect(again.tray).toBe(s.tray);
  });

  it('keeps each half on its side of the crown', () => {
    let s = createLevel(def);
    for (const id of ['a', 'b', 'c']) s = placeStone(s, id, 'left');
    expect(placeStone(s, 'd', 'left').error).toMatch(/crown/);
    expect(placeStone(s, 'd', 'right').error).toBeUndefined();
  });

  it('only a keystone closes the arch, and only the last gap', () => {
    let s = createLevel(def);
    expect(placeStone(s, 'key', 'left').error).toMatch(/keystone/);
    for (const [id, side] of [['a', 'left'], ['b', 'left'], ['c', 'left'], ['d', 'right'], ['w', 'right']] as const) {
      s = placeStone(s, id, side);
    }
    expect(s.left + s.right).toBe(6);
    expect(placeStone(s, 'thin', 'left').error).toMatch(/keystone/);
    expect(isClosed(s)).toBe(false);
    s = placeStone(s, 'key', 'right');
    expect(isClosed(s)).toBe(true);
    expect(s.phase).toBe('ready');
    expect(openFaces(s)).toEqual([]);
    expect(ringOrder(s).map(p => p.stone.id)).toEqual(['a', 'b', 'c', 'key', 'w', 'd']);
  });

  it('takes the outermost stone of a side back to its place in the tray', () => {
    let s = createLevel(def);
    s = placeStone(placeStone(placeStone(s, 'a', 'left'), 'b', 'left'), 'c', 'right');
    s = takeBack(s, 'left');
    expect(s.placed.map(p => p.stone.id)).toEqual(['a', 'c']);
    expect(s.tray.map(t => t.id)).toEqual(['b', 'd', 'w', 'thin', 'key']);
    expect(openFaces(s)[0]).toEqual({ side: 'left', slot: 1 });
    expect(takeBack(createLevel(def), 'right').error).toBeDefined();
  });
});

describe('the arch the solver sees', () => {
  const closed = (ids: [string, 'left' | 'right'][]) => ids.reduce((s, [id, side]) => placeStone(s, id, side), createLevel(def));

  it('has one block per stone, in ring order, and a joint only as deep as the thinner face', () => {
    const s = closed([['a', 'left'], ['thin', 'left'], ['b', 'left'], ['c', 'right'], ['w', 'right'], ['key', 'left']]);
    const arch = buildArch(s);
    expect(arch.blocks).toHaveLength(6);
    expect(arch.joints).toHaveLength(7);
    const len = ([p, q]: [{ x: number; y: number }, { x: number; y: number }]) => Math.hypot(q.x - p.x, q.y - p.y);
    expect(len(arch.joints[0])).toBeCloseTo(0.024, 12);
    expect(len(arch.joints[1])).toBeCloseTo(0.01, 12); // a | thin
    expect(len(arch.joints[2])).toBeCloseTo(0.01, 12); // thin | b
    expect(len(arch.joints[3])).toBeCloseTo(0.024, 12);
    expect(arch.blocks[1].density).toBe(1500);
  });

  it('strikes: a closed arch is judged by the solver, an open one falls', () => {
    const good = closed([['a', 'left'], ['b', 'left'], ['c', 'left'], ['d', 'right'], ['w', 'right'], ['key', 'left']]);
    const { state, result } = strike(good);
    expect(result).toEqual(solveArch(buildArch(good)));
    expect(state.phase).toBe(result.stands ? 'held' : 'collapsed');
    expect(strike(state).result).toBe(result); // striking twice changes nothing

    const open = strike(placeStone(createLevel(def), 'a', 'left'));
    expect(open.result.stands).toBe(false);
    expect(open.state.phase).toBe('collapsed');
    expect(placeStone(open.state, 'b', 'left').error).toBeDefined();
  });
});

describe('ringArch', () => {
  it('with one thickness on a semicircular centering is the semicircular arch of the centre line', () => {
    const t = 0.03;
    const a = ringArch({ span: 0.3, rise: 0.15, units: 9, pieces: Array.from({ length: 9 }, () => ({ units: 1, t })) });
    const b = semicircularArch({ R: 0.15 + t / 2, t, n: 9 });
    a.joints.forEach((j, i) => j.forEach((p, k) => {
      expect(p.x).toBeCloseTo(b.joints[i][k].x, 12);
      expect(p.y).toBeCloseTo(b.joints[i][k].y, 12);
    }));
  });

  it('builds wide pieces over two courses and rejects pieces that do not cover the centering', () => {
    const a = ringArch({ span: 0.3, rise: 0.15, units: 5, pieces: [{ units: 2, t: 0.02 }, { units: 1, t: 0.02 }, { units: 2, t: 0.02 }] });
    expect(a.blocks).toHaveLength(3);
    expect(() => ringArch({ span: 0.3, rise: 0.15, units: 5, pieces: [{ units: 2, t: 0.02 }] })).toThrow();
  });
});

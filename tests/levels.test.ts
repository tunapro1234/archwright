import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { checkLevel } from '../src/levels/search.js';
import { createLevel, placeStone, strike, type LevelDef } from '../src/game/arch-state.js';
import { intrados } from '../src/scene/layout.js';

describe('levels', () => {
  it('start with w1-1, w1-2, w1-3', () => {
    expect(LEVELS.slice(0, 3).map(l => l.id)).toEqual(['w1-1', 'w1-2', 'w1-3']);
  });

  it.each(LEVELS.map(l => [l.id, l] as const))('%s: solution holds, trap falls, par is the true minimum, choice is real', (_, l) => {
    const r = checkLevel(l);
    expect(r.solution.stands).toBe(true);
    expect(r.trap.stands).toBe(false);
    expect(r.par).toBe(l.par);
    expect(r.holding).toBeGreaterThan(0);
    expect(r.holding / r.closed).toBeLessThan(0.5); // most ways to close the arch fall
  }, 60_000); // solves every arrangement the tray allows; slow under nice 19 on a busy machine

  it('world 2 is pointed: its centering peaks at the rise, in a point', () => {
    const w2 = LEVELS.filter(l => l.id.startsWith('w2-'));
    expect(w2.length).toBeGreaterThanOrEqual(5);
    for (const l of w2) {
      expect(l.rise).toBeGreaterThan(l.span / 2);
      const top = intrados(l.span, l.rise, 32);
      expect(top[16].x).toBeCloseTo(0, 9);
      expect(top[16].y).toBeCloseTo(l.rise, 9);
      // Next to the crown the curve still climbs steeply towards it: a point, not a round top.
      const round = intrados(l.span, l.span / 2, 32);
      expect(top[16].y - top[15].y).toBeGreaterThan(2 * (round[16].y - round[15].y));
    }
  });

  it('w2-1: the same slim stones fall on a semicircular centering', () => {
    const play = (l: LevelDef) => {
      let s = createLevel(l);
      for (const st of l.solution) s = placeStone(s, st.stone, st.side);
      return strike(s).result.stands;
    };
    const l = LEVELS.find(x => x.id === 'w2-1')!;
    expect(play(l)).toBe(true);
    expect(play({ ...l, rise: l.span / 2 })).toBe(false);
  });

  it('every stone id is unique within its level', () => {
    for (const l of LEVELS) expect(new Set(l.tray.map(s => s.id)).size).toBe(l.tray.length);
  });
});

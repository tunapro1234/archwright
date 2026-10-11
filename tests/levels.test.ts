import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { checkLevel } from '../src/levels/search.js';

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

  it('every stone id is unique within its level', () => {
    for (const l of LEVELS) expect(new Set(l.tray.map(s => s.id)).size).toBe(l.tray.length);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DAILY_EPOCH, DAILY_KEY, dailyDate, dailyHeld, dailyLevel, dailyNumber, localDateISO, saveDailyHeld, shareCard,
} from '../src/game/daily.js';
import { DAILY_POOL } from '../src/levels/daily-pool.js';
import { checkLevel } from '../src/levels/search.js';
import { createLevel, placeStone, strike, type LevelDef, type Step } from '../src/game/arch-state.js';
import { loadProgress, STORAGE_KEY, type ProgressStorage } from '../src/game/progress.js';
import { LEVELS } from '../src/levels/index.js';
import { BOARD, dailySpot, markerSpots, MARKER, TABLET, TRAY } from '../src/scene/layout.js';

const day = (n: number) => {
  const d = new Date(DAILY_EPOCH + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const sig = (l: LevelDef) =>
  JSON.stringify([l.span, l.rise, l.stones, l.tray.map(t => [t.material, t.t, t.units, !!t.keystone]).sort(), l.loads ?? []]);
const play = (def: LevelDef, steps: Step[]) => {
  let s = createLevel(def);
  for (const st of steps) s = placeStone(s, st.stone, st.side);
  return s;
};
const memory = (): ProgressStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('daily levels', () => {
  it('every level of the pool passes the world rules (solution holds by 0.05, trap falls, par, 2-60 %)', () => {
    for (let i = 0; i < DAILY_POOL.length; i++) {
      const l = dailyLevel(day(i));
      const r = checkLevel(l);
      expect(r.solution.stands && r.solution.minMargin >= 0.05, `${l.id} solution`).toBe(true);
      expect(r.trap.stands, `${l.id} trap`).toBe(false);
      expect(l.par, `${l.id} par`).toBe(r.par);
      expect(r.holding / r.closed).toBeGreaterThanOrEqual(0.02);
      expect(r.holding / r.closed).toBeLessThanOrEqual(0.6);
    }
  });

  it('no level repeats within a pool length of days, wherever the run starts', () => {
    const n = DAILY_POOL.length;
    expect(n).toBeGreaterThanOrEqual(30);
    for (const start of [0, 17, n - 5, -40]) {
      const seen = new Set(Array.from({ length: n }, (_, i) => sig(dailyLevel(day(start + i)))));
      expect(seen.size).toBe(n);
    }
  });

  it('deals semicircle, pointed and loaded levels in turn', () => {
    for (let i = 0; i < 9; i++) {
      const l = dailyLevel(day(i));
      const kind = l.loads?.length ? 'loaded' : l.rise > l.span / 2 + 1e-9 ? 'pointed' : 'semicircle';
      expect(kind).toBe(['semicircle', 'pointed', 'loaded'][i % 3]);
    }
  });

  it('days before the epoch still have a level', () => {
    expect(dailyNumber('2026-09-30')).toBe(0);
    expect(dailyLevel('2026-09-30').id).toBe('daily-2026-09-30');
    expect(dailyLevel('2020-02-29').tray.length).toBeGreaterThan(0);
  });

  it('dailyDate reads a daily id and nothing else', () => {
    expect(dailyDate('daily-2026-10-12')).toBe('2026-10-12');
    expect(dailyDate('w1-1')).toBeNull();
    expect(dailyDate('daily-today')).toBeNull();
  });

  it('localDateISO uses the local calendar day', () => {
    expect(localDateISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateISO(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});

describe('share card', () => {
  const d = day(4);
  const l = dailyLevel(d);

  it('squares follow the ring from left springing to right, whatever order the stones went in', () => {
    const s = strike(play(l, l.solution)).state;
    const v = l.solution.slice(0, -1);
    const rightFirst = [...v.filter(st => st.side === 'right'), ...v.filter(st => st.side === 'left'), ...l.solution.slice(-1)];
    const rev = strike(play(l, rightFirst)).state;
    expect(shareCard(rev)).toBe(shareCard(s));
    expect(shareCard(s)).toContain('it held');
    expect(shareCard(strike(play(l, l.trap)).state)).toContain('it fell');
  });

  it('a world level gets a card too, named by its id', () => {
    const w = LEVELS[0];
    const k = shareCard(strike(play(w, w.solution)).state);
    expect(k).toContain(w.id);
    expect(k).toContain(`par ${w.par}`);
  });

  it('an open arch says so', () => {
    expect(shareCard(play(l, l.solution.slice(0, 2)))).toContain('not struck yet');
  });
});

describe('daily record', () => {
  it('remembers that today held, and only today', () => {
    const m = memory();
    expect(dailyHeld(m, '2026-10-12')).toBe(false);
    expect(saveDailyHeld(m, '2026-10-12', 7)).toBe(true);
    expect(dailyHeld(m, '2026-10-12')).toBe(true);
    expect(dailyHeld(m, '2026-10-13')).toBe(false);
  });

  it('never throws: no storage, a corrupt record, a storage that refuses', () => {
    expect(dailyHeld(null, '2026-10-12')).toBe(false);
    expect(saveDailyHeld(null, '2026-10-12', 5)).toBe(false);
    const m = memory();
    m.data.set(DAILY_KEY, '{nope');
    expect(dailyHeld(m, '2026-10-12')).toBe(false);
    const bad: ProgressStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    expect(dailyHeld(bad, '2026-10-12')).toBe(false);
    expect(saveDailyHeld(bad, '2026-10-12', 5)).toBe(false);
  });

  it('stays out of the progress save: a daily id there is dropped on load', () => {
    const m = memory();
    m.data.set(STORAGE_KEY, JSON.stringify({ solved: { 'daily-2026-10-12': { stones: 5, at: 'x' } }, current: 'daily-2026-10-12' }));
    const p = loadProgress(m);
    expect(Object.keys(p.solved)).toEqual([]);
    expect(p.current).toBe(LEVELS[0].id);
    expect(DAILY_KEY.startsWith('archwright.')).toBe(true);
    expect(DAILY_KEY).not.toBe(STORAGE_KEY);
  });
});

describe('daily layout', () => {
  it('the daily marker has a spot of its own beside the board', () => {
    const ids = LEVELS.map(l => l.id);
    const s = dailySpot(ids);
    expect(Math.abs(s.x)).toBeGreaterThan(BOARD.width / 2);
    for (const m of markerSpots(ids)) expect(Math.hypot(m.x - s.x, m.z - s.z)).toBeGreaterThanOrEqual(MARKER.size * 1.5);
  });

  it('the tablet stands on the board, clear of the tray', () => {
    expect(TABLET.x + TABLET.width / 2).toBeLessThan(BOARD.width / 2);
    expect(TABLET.z + TABLET.thickness).toBeLessThan(TRAY.z);
    expect(9 * (TABLET.tile + TABLET.tileGap)).toBeLessThan(TABLET.width);
  });
});

import { describe, expect, it } from 'vitest';
import { archChord, collapseCue, CUE_MAX_SECONDS, CUE_MAX_VOICES, SCALE_HZ, stoneNote, strikeCue, type Cue } from '../src/audio/music.js';
import { createLevel, placeStone, type GameState, type LevelDef, type PlacedStone } from '../src/game/arch-state.js';
import { LEVELS } from '../src/levels/index.js';
import { dailyLevel } from '../src/game/daily.js';

const semis = (f: number) => Math.round(12 * Math.log2(f / 440));
const build = (def: LevelDef, steps = def.solution): GameState => {
  let s = createLevel(def);
  for (const a of steps) s = placeStone(s, a.stone, a.side);
  expect(s.error).toBeUndefined();
  return s;
};
/** Courses from the stone's own abutment (slot is counted from the left for both sides). */
const course = (s: GameState, p: PlacedStone) => (p.side === 'left' ? p.slot : s.geometry.units - p.slot - p.stone.units);
const voices = (cue: Cue[]) => Math.max(...cue.map(c => cue.filter(d => d.t <= c.t && c.t < d.t + d.dur).length));

describe('the scale', () => {
  it('no two notes clash: no semitone, no tritone, no major seventh, in any octave', () => {
    for (const a of SCALE_HZ) for (const b of SCALE_HZ) {
      expect([1, 6, 11]).not.toContain(((semis(a) - semis(b)) % 12 + 12) % 12);
    }
  });
});

const days = ['2026-10-01', '2026-10-07', '2026-10-19', '2026-10-30'].map(dailyLevel);
describe.each([...LEVELS, ...days].map(d => [d.id, d] as const))('%s', (_, def) => {
  it('notes rise from each abutment to the keystone, the sides mirror, and solution and trap ring alike', () => {
    for (const steps of [def.solution, def.trap]) {
      const s = build(def, steps);
      const key = s.placed.find(p => p.stone.keystone)!;
      for (const p of s.placed) {
        expect(SCALE_HZ).toContain(stoneNote(s, p));
        if (p === key) continue;
        expect(stoneNote(s, p)).toBeLessThan(stoneNote(s, key));
        for (const q of s.placed) {
          if (q === key || q.stone.units !== p.stone.units) continue;
          if (course(s, q) === course(s, p)) expect(stoneNote(s, q)).toBe(stoneNote(s, p));
          if (q.side === p.side && course(s, q) > course(s, p)) expect(stoneNote(s, q)).toBeGreaterThanOrEqual(stoneNote(s, p));
        }
      }
      expect(archChord(s)).toEqual(s.placed.map(p => stoneNote(s, p)));
    }
  });
});

describe('collapse and strike', () => {
  it('a collapse is ordered, layered, short, at most 16 voices, and seeded', () => {
    for (let n = 0; n <= 40; n++) {
      const c = collapseCue(n, n * 31 + 5);
      expect(c[0].layer).toBe('crack');
      for (let i = 1; i < c.length; i++) expect(c[i].t).toBeGreaterThanOrEqual(c[i - 1].t);
      const first = (k: Cue['layer']) => c.findIndex(e => e.layer === k);
      expect(first('crack')).toBeLessThan(first('slide'));
      expect(first('slide')).toBeLessThan(first('impact'));
      expect(first('impact')).toBeLessThan(first('pebble'));
      expect(c.filter(e => e.layer === 'impact').length).toBeLessThanOrEqual(Math.max(1, n));
      for (const e of c) {
        expect(e.t + e.dur).toBeLessThanOrEqual(CUE_MAX_SECONDS);
        expect(e.gain).toBeGreaterThan(0);
        expect(e.gain).toBeLessThanOrEqual(1);
      }
      expect(voices(c)).toBeLessThanOrEqual(CUE_MAX_VOICES);
    }
    expect(collapseCue(9, 1)).toEqual(collapseCue(9, 1));
    expect(collapseCue(9, 1)).not.toEqual(collapseCue(9, 2));
  });

  it('the creak rises; a held arch settles low, a failing one cracks; both end within the silence', () => {
    for (const held of [true, false]) {
      const hz = strikeCue(held).filter(e => e.layer === 'creak').map(e => e.hz!);
      expect(hz.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < hz.length; i++) expect(hz[i]).toBeGreaterThan(hz[i - 1]);
      for (const e of strikeCue(held)) expect(e.t + e.dur).toBeLessThanOrEqual(0.8);
    }
    expect(strikeCue(true).at(-1)!.layer).toBe('impact');
    expect(strikeCue(false).at(-1)!.layer).toBe('crack');
  });
});

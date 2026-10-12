import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import {
  decodeArch, emptyProgress, encodeArch, loadProgress, recordWin, saveProgress, STORAGE_KEY, unlocked, type ProgressStorage,
} from '../src/game/progress.js';

const ids = LEVELS.map(l => l.id);
const memory = (init?: string): ProgressStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(init === undefined ? [] : [[STORAGE_KEY, init]]);
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('progress', () => {
  it('a saved current level past the unlocked ones is pulled back to the first open level', () => {
    const p = loadProgress(memory(JSON.stringify({ solved: { [ids[0]]: { stones: 5, at: 'x' } }, current: ids[6] })));
    expect(p.current).toBe(ids[1]);
  });

  it('drops entries with a bad stone count but keeps the good ones', () => {
    const p = loadProgress(memory(JSON.stringify({
      solved: { [ids[0]]: { stones: 5, at: 'a' }, [ids[1]]: { stones: -2, at: 'b' }, [ids[2]]: { stones: 3.5, at: 'c' } },
      current: ids[1],
    })));
    expect(Object.keys(p.solved)).toEqual([ids[0]]);
    expect(p.current).toBe(ids[1]);
  });

  it('replaying an earlier level keeps the record and moves on from that level', () => {
    let p = emptyProgress();
    for (const id of ids.slice(0, 4)) p = recordWin(p, id, 9, 'd1');
    p = recordWin(p, ids[1], 9, 'd2');
    expect(p.solved[ids[1]].at).toBe('d1');
    expect(p.current).toBe(ids[2]);
    expect(unlocked(p)).toEqual(ids.slice(0, 5));
  });

  it('a win on an unknown level changes nothing', () => {
    const p = recordWin(emptyProgress(), 'w9-9', 3, 'x');
    expect(p).toEqual(emptyProgress());
  });

  it('saves under the archwright key as JSON', () => {
    const s = memory();
    expect(saveProgress(s, recordWin(emptyProgress(), ids[0], 5, 'x'))).toBe(true);
    expect(JSON.parse(s.data.get(STORAGE_KEY)!)).toEqual({ solved: { [ids[0]]: { stones: 5, at: 'x' } }, current: ids[1] });
  });
});

describe('the arrangement kept with a win', () => {
  const def = LEVELS[0];
  const other = def.trap;

  it('encodes as tray index + side, a few bytes, and decodes back', () => {
    const code = encodeArch(def.id, def.solution)!;
    expect(code).toMatch(/^\d+[lr](,\d+[lr])*$/);
    expect(code.length).toBeLessThan(4 * def.solution.length);
    expect(decodeArch(def.id, code)).toEqual(def.solution);
    expect(encodeArch(def.id, [{ stone: 'nope', side: 'left' }])).toBeUndefined();
    expect(encodeArch('w9-9', def.solution)).toBeUndefined();
    for (const bad of ['', '0l,0r', '99l', '0x', '0l,', 5, null]) expect(decodeArch(def.id, bad)).toBeNull();
  });

  it('goes with the best result; a tie only fills a missing one; older saves still load', () => {
    let p = recordWin(emptyProgress(), def.id, 5, 'd1');
    expect(p.solved[def.id]).toEqual({ stones: 5, at: 'd1' });
    p = recordWin(p, def.id, 5, 'd2', def.solution);
    expect(p.solved[def.id]).toEqual({ stones: 5, at: 'd1', arch: encodeArch(def.id, def.solution) });
    p = recordWin(p, def.id, 5, 'd3', other);
    expect(p.solved[def.id].arch).toBe(encodeArch(def.id, def.solution));
    p = recordWin(p, def.id, 4, 'd4', other);
    expect(p.solved[def.id]).toEqual({ stones: 4, at: 'd4', arch: encodeArch(def.id, other) });

    const s = memory();
    saveProgress(s, p);
    expect(loadProgress(s)).toEqual(p);
    s.setItem(STORAGE_KEY, JSON.stringify({ solved: { [def.id]: { stones: 4, at: 'x', arch: '7l,7l' } }, current: def.id }));
    expect(loadProgress(s).solved[def.id]).toEqual({ stones: 4, at: 'x' });
  });
});

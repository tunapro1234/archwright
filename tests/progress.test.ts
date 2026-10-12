import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import {
  emptyProgress, loadProgress, recordWin, saveProgress, STORAGE_KEY, unlocked, type ProgressStorage,
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

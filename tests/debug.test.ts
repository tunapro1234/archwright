import { describe, expect, it } from 'vitest';
import { BUDGET, debugEnabled, debugLines, overBudget, type DebugInfo } from '../src/game/debug';

const base: DebugInfo = {
  fps: 71.96, frameMs: 1.234, drawCalls: 28, triangles: 6400, bodies: 0, collapsing: false, level: 'w1-1', state: 'ready',
  xrMode: null, features: [], planes: [], anchors: null, visibility: 'visible',
};

describe('debug overlay', () => {
  it('is on for ?debug and ?debug=1, off without it or for 0/false/off', () => {
    expect(debugEnabled('?debug=1')).toBe(true);
    expect(debugEnabled('?level=w1-1&debug')).toBe(true);
    expect(debugEnabled('?debug=true')).toBe(true);
    expect(debugEnabled('')).toBe(false);
    expect(debugEnabled('?level=w1-1')).toBe(false);
    for (const v of ['0', 'false', 'off', 'OFF']) expect(debugEnabled(`?debug=${v}`)).toBe(false);
  });

  it('matches the budget of juri/qa.md §7.1 and perf.kabul.mjs', () => {
    expect(BUDGET).toEqual({ drawCalls: 60, drawCallsCollapse: 100, triangles: 100000, bodies: 40 });
  });

  it('shows fps, JS ms, draw calls, triangles, bodies, XR features, planes, anchors and visibility', () => {
    const text = debugLines({
      ...base, xrMode: 'immersive-ar', features: ['hand-tracking', 'anchors'], planes: ['table', 'wall', 'table', ''],
      anchors: { plinths: 3, anchored: 2 }, visibility: 'visible-blurred',
    }).map(l => l.text).join('\n');
    expect(text).toContain('72.0 fps');
    expect(text).toContain('js 1.23 ms');
    expect(text).toContain('draws 28/60');
    expect(text).toContain('tris 6.4k/100k');
    expect(text).toContain('bodies 0/40');
    expect(text).toContain('xr immersive-ar · hand-tracking, anchors');
    expect(text).toContain('planes 4 (table, wall, ?)');
    expect(text).toContain('anchors 2/3');
    expect(text).toContain('visible-blurred');
  });

  it('marks a line whose number is over the budget, with the collapse allowance while collapsing', () => {
    expect(debugLines(base).some(l => l.over)).toBe(false);
    expect(overBudget({ ...base, drawCalls: 61 }).drawCalls).toBe(true);
    expect(overBudget({ ...base, drawCalls: 61, collapsing: true }).drawCalls).toBe(false);
    expect(overBudget({ ...base, drawCalls: 101, collapsing: true }).drawCalls).toBe(true);
    expect(debugLines({ ...base, drawCalls: 70, collapsing: true })[1].text).toContain('70/100');
    const over = debugLines({ ...base, triangles: 100001, bodies: 41 });
    expect(over[1].over).toBe(true);
    expect(over[2].over).toBe(true);
    expect(over[0].over || over[3].over || over[4].over).toBe(false);
  });

  it('keeps every line short enough for the slate (≤ 48 characters for a typical session)', () => {
    const lines = debugLines({
      ...base, triangles: 99999, xrMode: 'immersive-vr', features: ['local-floor', 'hand-tracking'],
      planes: ['table', 'floor'], anchors: { plinths: 8, anchored: 8 },
    });
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(48);
  });
});

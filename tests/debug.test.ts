import { describe, expect, it } from 'vitest';
import { BUDGET, debugEnabled, debugLines, overBudget, shortUA, type DebugInfo } from '../src/game/debug';

const base: DebugInfo = {
  fps: 71.96, frameMs: 1.234, drawCalls: 28, triangles: 6400, bodies: 0, collapsing: false, level: 'w1-1', state: 'ready',
  xrMode: null, features: [], planes: [], anchors: null, visibility: 'visible',
  build: '1645642', ua: 'OculusBrowser/41.2.0.12.79', p50: 72, p5: 58.04, n: 600,
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
    expect(over[0].over || over[3].over || over[4].over || over[5].over || over[6].over).toBe(false);
  });

  it('keeps every line short enough for the slate (≤ 48 characters for a typical session)', () => {
    const lines = debugLines({
      ...base, triangles: 99999, xrMode: 'immersive-vr', features: ['local-floor', 'hand-tracking'],
      planes: ['table', 'floor'], anchors: { plinths: 8, anchored: 8 }, p50: 71.96, p5: 35.5,
    });
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(48);
  });

  it('names the build and the browser, and the median and slow-frame rates with how many frames they cover', () => {
    const lines = debugLines(base).map(l => l.text);
    expect(lines).toHaveLength(7);
    expect(lines[5]).toBe('build 1645642 · OculusBrowser/41.2.0.12.79');
    expect(lines[6]).toBe('fps p50 72.0 · p5 58.0 (600 frames)');
    expect(debugLines({ ...base, n: 0, p50: 0, p5: 0 })[6].text).toBe('fps p50 - · p5 - (0 frames)');
  });

  it('shortens a user agent to the browser and its version', () => {
    const quest = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.2.0.12.79 SamsungBrowser/4.0 Chrome/138.0.7204.183 VR Safari/537.36';
    expect(shortUA(quest)).toBe('OculusBrowser/41.2.0.12.79');
    expect(shortUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36'))
      .toBe('HeadlessChrome/141.0.7390.37');
    expect(shortUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'))
      .toBe('Chrome/141.0.0.0');
    expect(shortUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57'))
      .toBe('Edg/141.0.3537.57');
    expect(shortUA('Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0')).toBe('Firefox/143.0');
    expect(shortUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'))
      .toBe('Safari/18.6');
    expect(shortUA('')).toBe('?');
    expect(shortUA('SomeBot')).toBe('SomeBot');
  });
});

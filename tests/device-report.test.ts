// The device report (src/game/debug.ts reportBody, reportUrl) and when the page offers it (src/game/xr-entry.ts
// reportAfter, reportShown): the lines in their order, one line per value, the link to a new GitHub issue with the body
// escaped and never longer than REPORT_MAX, nothing personal in it, and no link for a session that drew no XR frame.
import { describe, expect, it } from 'vitest';
import { REPORT_FOOTER, REPORT_MAX, reportBody, reportUrl, type ReportInfo } from '../src/game/debug';
import { reportAfter, reportShown } from '../src/game/xr-entry';

const QUEST_UA = 'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/41.2.0.12.79 SamsungBrowser/4.0 Chrome/132.0.6834.110 VR Safari/537.36';
const info = (o: Partial<ReportInfo> = {}): ReportInfo => ({
  fps: 71.96, frameMs: 1.2, drawCalls: 28, triangles: 6400, bodies: 0, collapsing: false, level: 'w1-1', state: 'ready',
  xrMode: 'immersive-ar', features: ['local-floor', 'hand-tracking', 'plane-detection'], planes: ['table', 'wall', 'wall'],
  anchors: null, visibility: 'visible', build: '1645642', ua: 'OculusBrowser/41.2.0.12.79', p50: 72, p5: 58.04, n: 600,
  mode: 'immersive-ar', blend: 'alpha-blend', surface: 'plane', input: 'generic-hand', meshes: ['table'], ...o,
});
const KEYS = ['build', 'ua', 'mode', 'blend', 'surface', 'planes', 'meshes', 'input', 'fps p50', 'fps p5', 'frames n', 'features'];
const keyOf = (l: string) => l.slice(0, l.indexOf(':'));
const bodyOf = (url: string) => new URL(url).searchParams.get('body') ?? '';

describe('reportBody', () => {
  it('the keys in order, one per line, then the footer', () => {
    const lines = reportBody(info()).split('\n');
    expect(lines.slice(0, KEYS.length).map(keyOf)).toEqual(KEYS);
    expect(lines.slice(KEYS.length)).toEqual(['', REPORT_FOOTER]);
    expect(REPORT_FOOTER).toBe('Archwright debug report (no personal data)');
  });

  it('the values', () => {
    expect(reportBody(info())).toBe([
      'build: 1645642', 'ua: OculusBrowser/41.2.0.12.79', 'mode: immersive-ar', 'blend: alpha-blend', 'surface: plane',
      'planes: 3 (table, wall)', 'meshes: 1 (table)', 'input: generic-hand', 'fps p50: 72.0', 'fps p5: 58.0', 'frames n: 600',
      'features: local-floor, hand-tracking, plane-detection', '', REPORT_FOOTER,
    ].join('\n'));
  });

  it('nothing yet: none, 0 and -', () => {
    const b = reportBody(info({ mode: null, blend: null, surface: null, input: null, planes: [], meshes: undefined, features: [], n: 0, p50: 0, p5: 0 }));
    for (const l of ['mode: none', 'blend: none', 'surface: none', 'input: none', 'planes: 0', 'meshes: 0', 'fps p50: -', 'fps p5: -', 'frames n: 0', 'features: none']) {
      expect(b.split('\n')).toContain(l);
    }
  });

  it('a value with a line break stays on its line', () => {
    const lines = reportBody(info({ features: ['a&b#c\nd'], surface: 'pick\r\nx' })).split('\n');
    expect(lines).toHaveLength(KEYS.length + 2);
    expect(lines).toContain('features: a&b#c d');
    expect(lines).toContain('surface: pick x');
  });

  it('nothing personal: the browser only by name and version, no other field', () => {
    const b = reportBody(info({ ua: QUEST_UA }));
    expect(b).toMatch(/^ua: OculusBrowser\/41\.2\.0\.12\.79$/m);
    expect(b).not.toMatch(/Quest 3|Linux|X11|Mozilla/);
    const keys = b.split('\n').filter(l => l.includes(': ')).map(keyOf);
    expect(keys).toEqual(KEYS);
    // Fields of the info that are not in KEYS (the level, the state, anchors, visibility ...) are not written.
    expect(b).not.toMatch(/w1-1|visible|anchors|level/);
  });
});

describe('reportUrl', () => {
  it('a new issue on the project, titled with the build, the body escaped', () => {
    const url = reportUrl(reportBody(info({ features: ['a&b#c\nd', 'x=y?z'] })));
    expect(url.startsWith('https://github.com/tunapro1234/archwright/issues/new?title=')).toBe(true);
    expect(url).not.toMatch(/[#\n ]/); // & only between the two parameters
    expect(url.split('&')).toHaveLength(2);
    const q = new URL(url).searchParams;
    expect(q.get('title')).toBe('Quest report 1645642');
    expect(q.get('body')).toBe(reportBody(info({ features: ['a&b#c\nd', 'x=y?z'] })));
    expect(q.get('body')).toMatch(/^features: a&b#c d, x=y\?z$/m);
  });

  it('a short body is not touched', () => {
    const body = reportBody(info());
    expect(bodyOf(reportUrl(body))).toBe(body);
  });

  it('too many features: as many as fit, how many were left out, at most REPORT_MAX', () => {
    const features = Array.from({ length: 2000 }, (_, i) => `feature-${i}`);
    const url = reportUrl(reportBody(info({ features })));
    expect(REPORT_MAX).toBe(8000);
    expect(url.length).toBeLessThanOrEqual(REPORT_MAX);
    expect(url.length).toBeGreaterThan(REPORT_MAX - 40); // not cut more than it needs
    const body = bodyOf(url);
    const lines = body.split('\n');
    expect(lines.slice(0, KEYS.length).map(keyOf)).toEqual(KEYS);
    expect(lines[lines.length - 1]).toBe(REPORT_FOOTER);
    const f = lines[KEYS.length - 1].slice('features: '.length).split(', ');
    const more = /^… \+(\d+) more$/.exec(f[f.length - 1]);
    expect(more).not.toBeNull();
    expect(f.length - 1 + Number(more![1])).toBe(2000);
    expect(f.slice(0, -1)).toEqual(features.slice(0, f.length - 1));
  });

  it('a body too long without features is cut, still at most REPORT_MAX', () => {
    const url = reportUrl(`build: abc\n${'é#&'.repeat(5000)}`);
    expect(url.length).toBeLessThanOrEqual(REPORT_MAX);
    expect(bodyOf(url).startsWith('build: abc\n')).toBe(true);
  });
});

describe('when the page offers the report', () => {
  it('no link before a session, and none while one runs', () => {
    expect(reportShown({ presenting: false, report: null })).toBe(false);
    expect(reportShown({ presenting: true, report: null })).toBe(false);
    expect(reportShown({ presenting: true, report: 'build: x' })).toBe(false);
    expect(reportShown({ presenting: false, report: 'build: x' })).toBe(true);
  });

  it('a session that drew no XR frame gives no report', () => {
    expect(reportAfter(null, { frames: 0, body: 'build: x' })).toBeNull();
    expect(reportShown({ presenting: false, report: reportAfter(null, { frames: 0, body: 'build: x' }) })).toBe(false);
  });

  it('each session with frames renews the one report; one without keeps the last', () => {
    const ar = reportAfter(null, { frames: 1, body: 'mode: immersive-ar' });
    expect(ar).toBe('mode: immersive-ar');
    const vr = reportAfter(ar, { frames: 200, body: 'mode: immersive-vr' });
    expect(vr).toBe('mode: immersive-vr');
    expect(reportAfter(vr, { frames: 0, body: 'mode: immersive-ar' })).toBe('mode: immersive-vr');
  });
});

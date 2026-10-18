import { describe, expect, it } from 'vitest';
import { FRAME_WINDOW, FrameStats } from '../src/game/frame-stats';

describe('frame stats (median and slow-frame rates)', () => {
  it('is empty before the first frame', () => {
    expect(new FrameStats().stats()).toEqual({ n: 0, p50: 0, p5: 0 });
  });

  it('a steady 72 Hz gives p50 = p5 = 72, and keeps only the last FRAME_WINDOW frames', () => {
    const f = new FrameStats();
    for (let i = 0; i < 700; i++) f.push(1 / 72);
    const s = f.stats();
    expect(FRAME_WINDOW).toBe(600);
    expect(s.n).toBe(600);
    expect(s.p50).toBeCloseTo(72, 2);
    expect(s.p5).toBeCloseTo(72, 2);
  });

  it('one frame in ten twice as long: p50 stays 72, p5 is 36', () => {
    const f = new FrameStats();
    for (let i = 0; i < 600; i++) f.push(i % 10 === 0 ? 2 / 72 : 1 / 72);
    const s = f.stats();
    expect(s.p50).toBeCloseTo(72, 2);
    expect(s.p5).toBeCloseTo(36, 2);
  });

  it('one frame in twenty-five slow is under the slowest 5 %: p5 stays 72', () => {
    const f = new FrameStats();
    for (let i = 0; i < 600; i++) f.push(i % 25 === 0 ? 3 / 72 : 1 / 72);
    expect(f.stats().p5).toBeCloseTo(72, 2);
  });

  it('old frames leave the window: after 600 frames at 36 Hz the 72 Hz ones are gone', () => {
    const f = new FrameStats();
    for (let i = 0; i < 600; i++) f.push(1 / 72);
    for (let i = 0; i < 600; i++) f.push(1 / 36);
    const s = f.stats();
    expect(s.n).toBe(600);
    expect(s.p50).toBeCloseTo(36, 2);
    expect(s.p5).toBeCloseTo(36, 2);
  });

  it('skips zero, negative and non-finite frame times; stats() leaves the window as it was', () => {
    const f = new FrameStats();
    for (const dt of [0, -1 / 72, Number.NaN, Number.POSITIVE_INFINITY]) f.push(dt);
    expect(f.stats().n).toBe(0);
    f.push(1 / 90);
    f.push(1 / 30);
    f.push(1 / 60);
    const a = f.stats();
    expect(a).toEqual(f.stats());
    expect(a.n).toBe(3);
    expect(a.p50).toBeCloseTo(60, 2);
    expect(a.p5).toBeCloseTo(30, 2);
  });
});

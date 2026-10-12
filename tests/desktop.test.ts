import { describe, expect, it } from 'vitest';
import { DRAG_PX, leverPull, ndcToCss } from '../src/game/desktop.js';

describe('leverPull', () => {
  const strike = 0.072, max = 0.085;
  it('reaches the strike pull at DRAG_PX, not before', () => {
    expect(leverPull(DRAG_PX, 0, strike, max)).toBeCloseTo(strike);
    expect(leverPull(DRAG_PX - 1, 0, strike, max)).toBeLessThan(strike);
  });
  it('carries on from where the lever was, and stays within its travel', () => {
    expect(leverPull(DRAG_PX / 2, 0.02, strike, max)).toBeCloseTo(0.02 + strike / 2);
    expect(leverPull(-500, 0.02, strike, max)).toBe(0);
    expect(leverPull(5000, 0, strike, max)).toBe(max);
  });
});

describe('ndcToCss', () => {
  const rect = { left: 10, top: 20, width: 1280, height: 720 };
  it('maps the corners and the centre of the view', () => {
    expect(ndcToCss(0, 0, 0.5, rect)).toEqual({ x: 650, y: 380 });
    expect(ndcToCss(-1, 1, 0.5, rect)).toEqual({ x: 10, y: 20 });
    expect(ndcToCss(1, -1, 0.5, rect)).toEqual({ x: 1290, y: 740 });
  });
  it('gives null for points behind the camera or beyond the far plane', () => {
    expect(ndcToCss(0, 0, 1.2, rect)).toBeNull();
    expect(ndcToCss(NaN, 0, 0, rect)).toBeNull();
  });
});

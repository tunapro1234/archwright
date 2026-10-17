import { describe, expect, it } from 'vitest';
import { frameDelta, isPaused, RESUME_DT } from '../src/game/pause.js';
import { LIMITER } from '../src/audio/music.js';

describe('clean pause', () => {
  it('the system menu (visible-blurred), the headset off (hidden) and a hidden tab pause; in view it runs', () => {
    expect(isPaused({ xrVisibility: 'visible', documentHidden: false })).toBe(false);
    expect(isPaused({ xrVisibility: 'visible-blurred', documentHidden: false })).toBe(true);
    expect(isPaused({ xrVisibility: 'hidden', documentHidden: false })).toBe(true);
    expect(isPaused({ xrVisibility: null, documentHidden: false })).toBe(false);
    expect(isPaused({ xrVisibility: null, documentHidden: true })).toBe(true);
    expect(isPaused({ xrVisibility: 'visible', documentHidden: true })).toBe(true);
  });

  it('the first frame back steps at most RESUME_DT; other frames step as they came', () => {
    expect(RESUME_DT).toBeLessThanOrEqual(0.1);
    expect(frameDelta(12, true)).toBe(RESUME_DT);
    expect(frameDelta(0.016, true)).toBe(0.016);
    expect(frameDelta(0.4, false)).toBe(0.4);
    expect(frameDelta(-1, false)).toBe(0);
  });

  it('the limiter before the speakers: -6 dB threshold, hard knee, 20:1, 3 ms attack, 100 ms release', () => {
    expect(LIMITER).toEqual({ threshold: -6, knee: 0, ratio: 20, attack: 0.003, release: 0.1 });
  });
});

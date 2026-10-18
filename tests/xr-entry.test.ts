// The page's own XR buttons (src/game/xr-entry.ts): none in a session; otherwise each mode the browser supports, AR
// first. All eight combinations.
import { describe, expect, it } from 'vitest';
import { xrButtons } from '../src/game/xr-entry.js';

describe('xrButtons', () => {
  const cases: [boolean, boolean, boolean, string[]][] = [
    [false, false, false, []],
    [true, false, false, ['ar']],
    [false, true, false, ['vr']],
    [true, true, false, ['ar', 'vr']],
    [false, false, true, []],
    [true, false, true, []],
    [false, true, true, []],
    [true, true, true, []],
  ];
  for (const [ar, vr, presenting, want] of cases) {
    it(`ar ${ar}, vr ${vr}, presenting ${presenting}: ${JSON.stringify(want)}`, () => {
      expect(xrButtons({ ar, vr, presenting })).toEqual(want);
    });
  }

  it('a new array each time, so the hook\'s list is never shared', () => {
    const s = { ar: true, vr: true, presenting: false };
    expect(xrButtons(s)).not.toBe(xrButtons(s));
  });
});

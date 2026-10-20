import { afterEach, describe, expect, it } from 'vitest';
import {
  A11Y_KEY, activePalette, defaultA11y, GAZE_WAKE_DWELL, gazePick, gazeWake, HOLD_TO_STRIKE, holdPull, loadA11y,
  parseA11yParam, saveA11y,
} from '../src/game/a11y.js';
import { COLORS, HIGH_CONTRAST, onRepaint, paint, PALETTE, usePalette } from '../src/scene/palette.js';
import { MATERIAL_COLOR } from '../src/scene/meshes.js';
import { A11Y_ICONS, A11Y_PANEL, a11yIconSpot, BOARD, dailySpot, MARKER, markerSpots, TRAY } from '../src/scene/layout.js';
import { LEVELS } from '../src/levels/index.js';
import type { ProgressStorage } from '../src/game/progress.js';

const memory = (): ProgressStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('a11y settings', () => {
  it('?a11y= takes any case, spaces and the long spellings', () => {
    expect(parseA11yParam(' Gaze , ONEHAND ')).toEqual({ gaze: true, oneHand: true });
    expect(parseA11yParam('one-hand,high-contrast')).toEqual({ oneHand: true, highContrast: true });
    expect(parseA11yParam(',,')).toEqual({});
  });

  it('a save round-trips and keeps only the three switches', () => {
    const m = memory();
    expect(saveA11y(m, { gaze: false, oneHand: true, highContrast: false })).toBe(true);
    expect(JSON.parse(m.data.get(A11Y_KEY)!)).toEqual({ gaze: false, oneHand: true, highContrast: false });
    expect(loadA11y(m)).toEqual({ gaze: false, oneHand: true, highContrast: false });
    m.data.set(A11Y_KEY, '7');
    expect(loadA11y(m)).toEqual(defaultA11y());
  });
});

describe('high-contrast palette', () => {
  afterEach(() => usePalette(PALETTE));

  it('switches every painted colour, the stone tints and the repaint callbacks, and back', () => {
    const seen: number[] = [];
    const color = { hex: -1, setHex(h: number) { this.hex = h; } };
    paint(color, 'centering');
    let calls = 0;
    onRepaint(() => { calls++; seen.push(MATERIAL_COLOR.basalt); });
    expect(color.hex).toBe(PALETTE.centering);
    usePalette(activePalette({ ...defaultA11y(), highContrast: true }));
    expect(color.hex).toBe(HIGH_CONTRAST.centering);
    expect(COLORS).toEqual({ ...HIGH_CONTRAST });
    expect(MATERIAL_COLOR.sandstone).toBe(HIGH_CONTRAST.sandstone);
    expect(seen).toEqual([HIGH_CONTRAST.basalt]); // callbacks run after the colours changed
    usePalette(HIGH_CONTRAST);
    expect(calls).toBe(1); // the same palette again is no change
    usePalette(PALETTE);
    expect(color.hex).toBe(PALETTE.centering);
    expect(MATERIAL_COLOR.tuff).toBe(PALETTE.tuff);
    expect(calls).toBe(2);
  });

  it('PALETTE itself never changes', () => {
    const before = { ...PALETTE };
    usePalette(HIGH_CONTRAST);
    expect({ ...PALETTE }).toEqual(before);
  });
});

describe('gaze and hold', () => {
  const O = { x: 0.1, y: 1.1, z: 0.2 };
  it('a zero direction picks nothing; the origin need not be at zero', () => {
    const t = [{ id: 'a', center: { x: 0.1, y: 1.1, z: -0.3 }, radius: 0.02 }];
    expect(gazePick(O, { x: 0, y: 0, z: 0 }, t)).toBeNull();
    expect(gazePick(O, { x: 0, y: 0, z: -2 }, t)).toBe('a');
  });

  it('of two targets on the ray the nearer wins, whatever their order or size', () => {
    const near = { id: 'near', center: { x: 0.1, y: 1.1, z: -0.2 }, radius: 0.01 };
    const big = { id: 'big', center: { x: 0.1, y: 1.1, z: -0.3 }, radius: 0.06 };
    expect(gazePick(O, { x: 0, y: 0, z: -1 }, [big, near])).toBe('near');
    // A big sphere just behind a small one is entered first: its surface is nearer.
    const bigger = { ...big, radius: 0.13 };
    expect(gazePick(O, { x: 0, y: 0, z: -1 }, [near, bigger])).toBe('big');
  });

  it('with `only`, the targets left out neither block the ray nor are hit; [] hits nothing; without it, as before', () => {
    const near = { id: 'near', center: { x: 0.1, y: 1.1, z: -0.1 }, radius: 0.05 };
    const icon = { id: 'a11y:gaze', center: { x: 0.1, y: 1.1, z: -0.4 }, radius: 0.011 };
    const D = { x: 0, y: 0, z: -1 };
    expect(gazePick(O, D, [near, icon])).toBe('near');
    expect(gazePick(O, D, [near, icon], 1.5, ['a11y:gaze'])).toBe('a11y:gaze');
    expect(gazePick(O, D, [near, icon], 1.5, [])).toBeNull();
    expect(gazePick(O, D, [near, icon], 1.5, ['near', 'a11y:gaze'])).toBe('near');
    expect(gazePick(O, D, [near, icon], 0.3, ['a11y:gaze'])).toBeNull();
    expect(gazePick(O, { x: 0, y: 1, z: 0 }, [near, icon], 1.5, ['a11y:gaze'])).toBeNull();
  });

  it('gazeWake: the dwell grows while looked at and drops to 0 when not; a pinch counts from GAZE_WAKE_DWELL', () => {
    expect(GAZE_WAKE_DWELL).toBe(0.6);
    const a = gazeWake(0.5, true, true, 0.09);
    expect(a.dwell).toBeCloseTo(0.59, 9);
    expect(a.on).toBe(false);
    expect(gazeWake(0.5, true, true, 0.1)).toEqual({ dwell: 0.6, on: true });
    expect(gazeWake(2, false, true, 0.1)).toEqual({ dwell: 0, on: false });
    const b = gazeWake(1, true, false, 0.1);
    expect(b.dwell).toBeCloseTo(1.1, 9);
    expect(b.on).toBe(false);
    expect(gazeWake(0, true, true, 0)).toEqual({ dwell: 0, on: false });
    expect(gazeWake(0.3, true, false, -1).dwell).toBe(0.3);
  });

  it('holding the handle HOLD_TO_STRIKE pulls exactly to the strike; less, part of the way', () => {
    expect(HOLD_TO_STRIKE).toBe(0.8);
    expect(holdPull(0, 0, 0.072, 0.085)).toBe(0);
    expect(holdPull(HOLD_TO_STRIKE, 0, 0.072, 0.085)).toBeCloseTo(0.072, 9);
    expect(holdPull(HOLD_TO_STRIKE / 2, 0.01, 0.072, 0.085)).toBeCloseTo(0.046, 9);
    expect(holdPull(10, 0, 0.072, 0.085)).toBe(0.085);
    expect(holdPull(-1, 0.02, 0.072, 0.085)).toBe(0.02);
  });
});

describe('a11y panel layout', () => {
  const ids = LEVELS.map(l => l.id);
  const P = A11Y_PANEL;
  const box = { x0: P.x - P.width / 2, x1: P.x + P.width / 2, z0: P.z - P.depth / 2, z1: P.z + P.depth / 2 };

  it('stands off the board, within reach of its edge, on the board side of the player', () => {
    expect(box.x1).toBeLessThan(-BOARD.width / 2 - 0.01);
    expect(-BOARD.width / 2 - box.x0).toBeLessThanOrEqual(0.3);
    expect(box.z1).toBeLessThanOrEqual(BOARD.zMax);
    expect(box.z0).toBeGreaterThan(TRAY.z); // level with the tray, nearer the player than the arch
  });

  it('clears every level marker and the daily marker', () => {
    const spots = [...markerSpots(ids), { id: 'today', ...dailySpot(ids) }];
    for (const s of spots) {
      const dx = Math.max(box.x0 - s.x, 0, s.x - box.x1), dz = Math.max(box.z0 - s.z, 0, s.z - box.z1);
      expect(Math.hypot(dx, dz), s.id).toBeGreaterThanOrEqual(MARKER.size);
    }
  });

  it('three icons fit on the slab, far enough apart to pinch one', () => {
    expect(A11Y_ICONS).toEqual(['gaze', 'oneHand', 'highContrast']);
    const xs = A11Y_ICONS.map((_, i) => a11yIconSpot(i).x);
    for (const x of xs) expect(Math.abs(x) + P.icon).toBeLessThanOrEqual(P.width / 2);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2 * P.icon + 0.006);
  });
});

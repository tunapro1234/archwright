import { describe, expect, it } from 'vitest';
import {
  cue, GHOST_DURATION, GHOST_MAX, GHOST_PINCH_AT, ghostFrame, initialOnboard, loadOnboard, ONBOARD_KEY, saveOnboard, step,
  type Onboard, type OnboardEvent,
} from '../src/game/onboarding.js';

const run = (o: Onboard, ...ev: OnboardEvent[]) => ev.reduce(step, o);
const first = { level: 'w1-1', phase: 'building', handNearCentering: false } as const;

describe('onboarding state', () => {
  it('ticks only count with hands in view, before a grab, while showings are left', () => {
    const o = run(initialOnboard(), { type: 'tick', dt: 2, handsVisible: true }, { type: 'tick', dt: 5, handsVisible: false });
    expect(o.idleS).toBe(2);
    expect(run(o, { type: 'grab' }, { type: 'tick', dt: 4, handsVisible: true }).idleS).toBe(2);
    expect(run(o, { type: 'tick', dt: Number.NaN, handsVisible: true }).idleS).toBe(2);
  });
  it('a showing resets the idle time and never counts past the maximum', () => {
    let o = initialOnboard();
    for (let i = 0; i < GHOST_MAX + 2; i++) o = run(o, { type: 'tick', dt: 20, handsVisible: true }, { type: 'ghost-played' });
    expect(o.ghostShown).toBe(GHOST_MAX);
    expect(o.idleS).toBe(0);
    expect(cue(run(o, { type: 'tick', dt: 99, handsVisible: true }), first)).toBe('none');
  });
  it('the glow belongs to a closed arch only, and stops for good after a strike', () => {
    const o = initialOnboard();
    expect(cue(o, { level: 'w1-1', phase: 'ready', handNearCentering: true })).toBe('glow-centering');
    expect(cue(o, { level: 'w3-2', phase: 'held', handNearCentering: true })).toBe('none');
    expect(cue(run(o, { type: 'strike' }), { level: 'w1-1', phase: 'ready', handNearCentering: true })).toBe('none');
  });
  it('a save keeps only the four fields and reads back the same', () => {
    const box = new Map<string, string>();
    const s = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v) };
    const o = { ...run(initialOnboard(), { type: 'ghost-played' }, { type: 'tick', dt: 3, handsVisible: true }), extra: 1 } as Onboard;
    expect(saveOnboard(s, o)).toBe(true);
    expect(Object.keys(JSON.parse(box.get(ONBOARD_KEY)!)).sort()).toEqual(['ghostShown', 'grabbed', 'idleS', 'struck']);
    expect(loadOnboard(s)).toEqual({ ghostShown: 1, grabbed: false, struck: false, idleS: 3 });
    expect(saveOnboard(null, o)).toBe(false);
  });
});

describe('ghost hand timeline', () => {
  it('fits in four seconds, fades in and out, and goes stone → face', () => {
    expect(GHOST_DURATION).toBeLessThanOrEqual(4);
    expect(ghostFrame(0).alpha).toBe(0);
    expect(ghostFrame(GHOST_DURATION).alpha).toBe(0);
    expect(ghostFrame(1).alpha).toBe(1);
    expect(ghostFrame(0.5)).toMatchObject({ from: 'above', to: 'stone' });
    expect(ghostFrame(2)).toMatchObject({ from: 'stone', to: 'face' });
    expect(ghostFrame(3.5)).toMatchObject({ from: 'face', to: 'above-face' });
  });
  it('fingers open while reaching, closed while carrying, the stone only shows once pinched', () => {
    expect(ghostFrame(0.5).open).toBe(1);
    expect(ghostFrame(GHOST_PINCH_AT).open).toBeLessThan(0.3);
    expect(ghostFrame(2).open).toBe(0);
    expect(ghostFrame(3.2).open).toBe(1);
    expect(ghostFrame(1).stoneAlpha).toBe(0);
    expect(ghostFrame(2).stoneAlpha).toBe(1);
    expect(ghostFrame(3.4).stoneAlpha).toBe(0);
  });
  it('the carry starts at the stone and ends on the face, arcing in between', () => {
    expect(ghostFrame(1.15)).toMatchObject({ u: 0, lift: 0 });
    expect(ghostFrame(1.95).lift).toBeCloseTo(1, 5);
    const end = ghostFrame(2.75);
    expect(end.u).toBe(1);
    expect(end.lift).toBeCloseTo(0, 6);
  });
});

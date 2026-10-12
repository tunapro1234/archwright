import { describe, expect, it } from 'vitest';
import { MONUMENTS, monumentOf, plaqueText } from '../src/levels/monuments.js';
import { LEVELS } from '../src/levels/index.js';
import { markerSpots, markerWorld } from '../src/scene/layout.js';
import { loadHandles } from '../src/game/museum.js';

const ids = LEVELS.map(l => l.id);

describe('monuments', () => {
  it('plaque lines are the sourced values, nothing more', () => {
    expect(plaqueText(monumentOf('m-tiberio')!)).toEqual(['Ponte di Tiberio · Rimini · AD 14–21', 'semicircular arches · longest span ≈ 10.6 m']);
    expect(plaqueText(monumentOf('m-malabadi')!)).toEqual(['Malabadi Bridge · Silvan, Diyarbakır · c. 1147–1154', 'pointed arch · span ≈ 38.6 m']);
    expect(monumentOf('w1-1')).toBeUndefined();
  });
  it('every monument has a level, right after its world', () => {
    for (const m of MONUMENTS) expect(ids).toContain(m.levelId);
    expect(ids.slice(ids.indexOf('m-tiberio') - 1, ids.indexOf('m-tiberio') + 2)).toEqual(['w1-5', 'm-tiberio', 'w2-1']);
    expect(ids.slice(ids.indexOf('m-malabadi') - 1, ids.indexOf('m-malabadi') + 2)).toEqual(['w2-5', 'm-malabadi', 'w3-1']);
  });
  it("a monument's marker ends its world's column; the other columns do not move", () => {
    expect(markerWorld(ids, ids.indexOf('m-tiberio'))).toBe('w1');
    expect(markerWorld(ids, ids.indexOf('m-malabadi'))).toBe('w2');
    const spots = markerSpots(ids);
    const at = (id: string) => spots.find(s => s.id === id)!;
    expect(at('m-tiberio').x).toBe(at('w1-1').x);
    expect(at('m-tiberio').z).toBeGreaterThan(at('w1-5').z);
    expect(at('m-malabadi').x).toBe(at('w2-1').x);
    expect(at('w2-1').x).toBe(-at('w1-1').x);
    expect(new Set(spots.map(s => `${s.x},${s.z}`)).size).toBe(spots.length);
  });
  it('the museum keeps anchor handles for monument plinths too', () => {
    const box = new Map([['archwright.museum.v1', JSON.stringify({ handles: { 'monument:m-tiberio': 'h1', 'world:w1': 'h2', 'bogus': 'x' } })]]);
    const s = { getItem: (k: string) => box.get(k) ?? null, setItem: () => {} };
    expect(loadHandles(s)).toEqual({ 'monument:m-tiberio': 'h1', 'world:w1': 'h2' });
  });
});

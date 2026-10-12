// What the game sounds like, as plain data: no WebAudio, no window (synth.ts plays it).
// The arch is a lithophone. Every stone rings one note of a major pentatonic scale, chosen by its
// place in the ring: the stones at the abutments are low, each course nearer the crown is higher,
// and the keystone is the highest. The two sides are mirrors, so the same course left and right is
// the same note. A pentatonic scale has no semitone and no tritone, so whatever stones are seated,
// in whatever order, they sound together without a clash; a held arch rings all its notes as a
// chord. A collapse is a short score of layered events (crack, slide, impacts, pebbles) and the
// strike is the centering's creak; both are deterministic, from a seed, with no Math.random.
import type { GameState, PlacedStone } from '../game/arch-state.js';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
/** C major pentatonic, C3 to C6 (131 to 1047 Hz), rising; equal temperament, A4 = 440 Hz. */
export const SCALE_HZ: readonly number[] = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84].map(hz);
const TOP = SCALE_HZ.length - 1; // the keystone's note, C6
const STEP = 2;                  // scale steps per course down from the crown

/** The note (Hz, one of SCALE_HZ) a seated stone rings: high at the crown, low at the abutments. */
export function stoneNote(state: GameState, placed: PlacedStone): number {
  const u = state.geometry.units;
  const centre = placed.slot + placed.stone.units / 2; // in courses from the left abutment
  const fromCrown = placed.stone.keystone ? 0 : Math.abs(u / 2 - centre);
  return SCALE_HZ[Math.max(0, TOP - Math.round(STEP * fromCrown))];
}

/** The notes of every seated stone, in placement order (the held arch's chord). */
export function archChord(state: GameState): number[] {
  return state.placed.map(p => stoneNote(state, p));
}

export type CueLayer = 'crack' | 'slide' | 'impact' | 'pebble' | 'creak';
/** One sound event: start t and length dur (s), gain (0, 1], and a pitch or filter centre hz. */
export interface Cue { t: number; dur: number; gain: number; layer: CueLayer; hz?: number }

export const CUE_MAX_SECONDS = 3.5;
export const CUE_MAX_VOICES = 16;
const LAYER_ORDER: Record<CueLayer, number> = { creak: 0, crack: 1, slide: 2, impact: 3, pebble: 4 };

/** mulberry32: a small seeded generator, so a seed always gives the same collapse. */
function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Sort by time (layer order on a tie), cut at CUE_MAX_SECONDS and drop what would make a 17th voice. */
function finish(events: Cue[]): Cue[] {
  const sorted = events
    .map(e => ({ ...e, t: round(e.t), dur: round(Math.min(e.dur, CUE_MAX_SECONDS - e.t)), gain: round(e.gain) }))
    .filter(e => e.t >= 0 && e.dur > 0 && e.gain > 0)
    .sort((a, b) => a.t - b.t || LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
  const out: Cue[] = [];
  for (const e of sorted) {
    const sounding = out.filter(d => d.t <= e.t && e.t < d.t + d.dur).length;
    if (sounding < CUE_MAX_VOICES) out.push(e);
  }
  return out;
}

/**
 * The sound of an arch falling, for `bodies` stones: a crack where the first hinge opens, the
 * grind of stones sliding on their joints, one impact per stone as it lands (heavier and lower
 * first, at most one per stone and ten in all), then pebbles skittering. At most 3.5 s and 16
 * voices at once; the same seed gives the same score.
 */
export function collapseCue(bodies: number, seed: number): Cue[] {
  const r = rng(seed);
  const n = Math.max(1, Math.floor(bodies));
  const e: Cue[] = [];
  e.push({ t: 0, dur: 0.09, gain: 0.9, layer: 'crack', hz: 2400 + 800 * r() });
  e.push({ t: 0.04 + 0.08 * r(), dur: 0.07, gain: 0.55, layer: 'crack', hz: 3000 + 900 * r() });
  const slides = n >= 5 ? 2 : 1;
  for (let i = 0; i < slides; i++) {
    e.push({ t: 0.14 + 0.1 * i + 0.06 * r(), dur: 0.7 + 0.04 * Math.min(n, 12) + 0.2 * r(), gain: 0.32 - 0.08 * i, layer: 'slide', hz: 380 + 260 * r() });
  }
  const impacts = Math.min(n, 10);
  for (let i = 0; i < impacts; i++) {
    const k = impacts === 1 ? 0 : i / (impacts - 1);
    e.push({ t: 0.5 + 1.5 * k + 0.12 * r(), dur: 0.28 + 0.14 * r(), gain: 0.95 - 0.45 * k, layer: 'impact', hz: 70 + 70 * k + 30 * r() });
  }
  const pebbles = Math.min(14, 3 + n);
  for (let i = 0; i < pebbles; i++) {
    e.push({ t: 0.9 + 2.3 * r(), dur: 0.05 + 0.08 * r(), gain: 0.08 + 0.2 * r(), layer: 'pebble', hz: 1800 + 2400 * r() });
  }
  return finish(e);
}

/**
 * The strike, from the moment the centering comes free to the verdict (StaticsSystem.SILENCE):
 * the timber creaks, rising in pitch as the stones take its load. A held arch ends on a low settle
 * as the joints bed in; a failing one on a first hairline crack.
 */
export function strikeCue(held: boolean): Cue[] {
  const e: Cue[] = [0, 0.13, 0.27, 0.4].map((t, i) => ({ t, dur: 0.15, gain: 0.22 + 0.04 * i, layer: 'creak' as const, hz: 150 + 55 * i }));
  e.push(held
    ? { t: 0.5, dur: 0.3, gain: 0.25, layer: 'impact', hz: 85 }
    : { t: 0.48, dur: 0.06, gain: 0.45, layer: 'crack', hz: 3200 });
  return finish(e);
}

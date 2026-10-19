// Every sound in the game, synthesised with WebAudio: no recordings, no files, nothing to license.
// What to play is decided in music.ts (pure data); this file only renders it. The AudioContext is
// only created after a user gesture or an XR session start, so a page that nobody touched
// (autotest, headless checks) stays silent and logs nothing. While the game is paused (src/systems/pause.ts:
// the system menu, the headset off, a hidden tab) the context is suspended. Every sound goes through one
// master gain and a limiter (music.LIMITER) before the speakers, so a pile of collapse voices cannot clip.
import { CUE_MAX_VOICES, LIMITER, type Cue } from './music.js';

let ctx: AudioContext | undefined;
let out: AudioNode | undefined;          // master gain, into the limiter
let noise: AudioBuffer | undefined;
let held = false;
/** __archwright.audio: the context's state ('none' before it exists) and whether the limiter is in the output. */
export const audioState: { state: AudioContextState | 'none'; limiter: boolean } = { state: 'none', limiter: false };
const MAX_NODES = 2 * CUE_MAX_VOICES; // sources sounding at once, whatever asked for them
let ends: number[] = [];                // when each sounding source stops

/** Room for one more source at `at`? (A full house drops the new one, never cuts an old one.) */
function voice(c: AudioContext, at: number, dur: number): boolean {
  const now = c.currentTime;
  ends = ends.filter(e => e > now);
  if (ends.length >= MAX_NODES) return false;
  ends.push(at + dur);
  return true;
}

/** Call from a user gesture (pointer/key) or when an XR session starts. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const c = ctx;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    const master = c.createGain();
    master.connect(limiter).connect(c.destination);
    out = master;
    audioState.limiter = true;
    audioState.state = c.state;
    c.addEventListener('statechange', () => { audioState.state = c.state; });
    // One second of deterministic white noise (xorshift), reused by every burst.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let x = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
    }
  }
  if (ctx.state === 'suspended' && !held) void ctx.resume();
}

/** The game paused (true) or went on (false): suspend or resume the sound, scheduled sounds included. */
export function holdAudio(pause: boolean): void {
  held = pause;
  if (!ctx) return;
  if (pause) void ctx.suspend();
  else void ctx.resume();
}

function ready(): AudioContext | undefined {
  return ctx && ctx.state === 'running' ? ctx : undefined;
}

function burst(c: AudioContext, at: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1, sweep = 1) {
  if (!voice(c, at, dur)) return;
  const src = c.createBufferSource();
  src.buffer = noise!;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweep !== 1) {
    f.frequency.setValueAtTime(freq, at);
    f.frequency.exponentialRampToValueAtTime(freq * sweep, at + dur);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(at, (at * 7.3) % 0.9, dur + 0.05);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, attack = 0.004, type: OscillatorType = 'sine', glide = 1) {
  if (!voice(c, at, dur)) return;
  const o = c.createOscillator();
  o.type = type; o.frequency.value = freq;
  if (glide !== 1) {
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(freq * glide, at + dur);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out!);
  o.start(at); o.stop(at + dur + 0.05);
}

/** Stone seats on a face: a short, dry "tock". */
export function playTick(): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime;
  burst(c, t, 0.05, 0.5, 'bandpass', 2400, 4);
  tone(c, t, 820, 0.07, 0.35);
  tone(c, t, 1310, 0.04, 0.12);
}

/** Refused placement: a dull knock. */
export function playReject(): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime;
  tone(c, t, 170, 0.12, 0.35, 0.003, 'triangle');
  burst(c, t, 0.06, 0.2, 'lowpass', 500);
}

/** Centering slides: a soft wooden scrape. */
export function playScrape(): void {
  const c = ready(); if (!c) return;
  burst(c, c.currentTime, 0.35, 0.12, 'bandpass', 900, 0.7);
}

/**
 * A stone seats and rings its note (music.stoneNote): a struck stone bar, its fundamental with the
 * two inharmonic overtones of a free bar (2.76 and 5.40 times), the high ones dying first.
 */
export function playStone(hz: number, at = 0): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime + at;
  burst(c, t, 0.03, 0.35, 'bandpass', Math.min(6000, hz * 3), 3);
  tone(c, t, hz, 0.9, 0.3, 0.003);
  tone(c, t, hz * 2.76, 0.32, 0.1, 0.002);
  tone(c, t, hz * 5.4, 0.12, 0.05, 0.002);
}

/** The arch holds: its stones' notes (music.archChord) rung once each, low to high, then together. */
export function playChord(notes: readonly number[]): void {
  const c = ready(); if (!c) return;
  const distinct = [...new Set(notes)].sort((a, b) => a - b);
  const t = c.currentTime;
  distinct.forEach((hz, i) => {
    const at = t + 0.09 * i;
    tone(c, at, hz, 2.8 - 0.09 * i, 0.22 / Math.sqrt(distinct.length), 0.004);
    tone(c, at, hz * 2.76, 0.4, 0.05, 0.002);
  });
}

/** A score from music.collapseCue, strikeCue, grabCue or homeCue, scheduled from now. */
export function playCue(cue: readonly Cue[]): void {
  const c = ready(); if (!c) return;
  const t0 = c.currentTime;
  for (const e of cue) {
    const at = t0 + e.t, hz = e.hz ?? 1000;
    switch (e.layer) {
      case 'crack': burst(c, at, e.dur, e.gain, 'highpass', hz, 0.8); break;
      case 'slide': burst(c, at, e.dur, e.gain, 'bandpass', hz, 1.2, 0.55); break;
      case 'impact':
        tone(c, at, hz * 1.5, e.dur, e.gain * 0.6, 0.002, 'sine', 0.66);
        burst(c, at, e.dur * 0.6, e.gain * 0.5, 'lowpass', hz * 5, 0.7);
        break;
      case 'pebble': tone(c, at, hz, e.dur, e.gain, 0.001, 'triangle', 0.9); break;
      case 'knock':
        // A stone taken in the hand: a narrow band of noise and a quick sine that drops, no ring.
        burst(c, at, e.dur, e.gain, 'bandpass', hz, 3);
        tone(c, at, hz, e.dur * 0.8, e.gain * 0.6, 0.002, 'sine', 0.8);
        break;
      case 'creak': {
        // Timber under load: a buzzy tone through a narrow band, sliding up a little.
        if (!voice(c, at, e.dur)) break;
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(hz * 0.97, at);
        o.frequency.linearRampToValueAtTime(hz * 1.04, at + e.dur);
        const f = c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = hz * 4; f.Q.value = 5;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(e.gain, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + e.dur);
        o.connect(f).connect(g).connect(out!);
        o.start(at); o.stop(at + e.dur + 0.05);
        break;
      }
    }
  }
}

/** The ghost hand's fingers meet on a stone: a soft, low wooden touch (quieter than a real seat). */
export function playGhostPinch(): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime;
  burst(c, t, 0.08, 0.08, 'bandpass', 700, 2);
  tone(c, t, 392, 0.35, 0.08, 0.02);
}

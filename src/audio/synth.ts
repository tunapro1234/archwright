// Placeholder sound, synthesised with WebAudio (no files, nothing to license). The AudioContext
// is only created after a user gesture or an XR session start, so a page that nobody touched
// (autotest, headless checks) stays silent and logs nothing.

let ctx: AudioContext | undefined;
let noise: AudioBuffer | undefined;

/** Call from a user gesture (pointer/key) or when an XR session starts. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // One second of deterministic white noise (xorshift), reused by every burst.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let x = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      d[i] = ((x >>> 0) / 0xffffffff) * 2 - 1;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function ready(): AudioContext | undefined {
  return ctx && ctx.state === 'running' ? ctx : undefined;
}

function burst(c: AudioContext, at: number, dur: number, gain: number, type: BiquadFilterType, freq: number, q = 1) {
  const src = c.createBufferSource();
  src.buffer = noise!;
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(at, (at * 7.3) % 0.9, dur + 0.05);
}

function tone(c: AudioContext, at: number, freq: number, dur: number, gain: number, attack = 0.004, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
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

/** The arch holds: a low, slow chord. */
export function playHold(): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime;
  for (const [f, g] of [[110, 0.22], [164.8, 0.16], [220, 0.1]] as const) tone(c, t, f, 2.4, g, 0.25);
}

/** The arch fails: layered cracks over a rumble. */
export function playCollapse(): void {
  const c = ready(); if (!c) return;
  const t = c.currentTime;
  const cracks = [0, 0.07, 0.11, 0.2, 0.26, 0.38, 0.5, 0.71];
  cracks.forEach((dt, i) => burst(c, t + dt, 0.05 + (i % 3) * 0.02, 0.6 - i * 0.05, 'highpass', 1800 + (i % 4) * 600));
  burst(c, t + 0.05, 1.4, 0.45, 'lowpass', 140, 0.8);
}

// Frame times over the last few seconds, for a report from a headset: the ?debug slate and __archwright.perf give the
// median frame rate and the rate of the slow frames, not just the smoothed rate of this moment. Pure: frame times
// (seconds) go in, numbers come out. A ring of FRAME_WINDOW times, allocated once; push() allocates nothing.

/** Frames kept: about 8 s at 72 Hz. */
export const FRAME_WINDOW = 600;

export interface FrameSummary {
  /** Frames in the window (≤ FRAME_WINDOW). */
  n: number;
  /** Frame rate of the median frame time (fps); 0 when there are no frames. */
  p50: number;
  /** Frame rate of the 95th percentile frame time, the slowest 5 % of frames (fps); 0 when there are no frames. */
  p5: number;
}

export class FrameStats {
  private times = new Float32Array(FRAME_WINDOW);
  private sorted = new Float32Array(FRAME_WINDOW);
  private next = 0;
  private count = 0;

  /** One frame's time in seconds; a zero, negative or non-finite time is skipped. */
  push(dtSeconds: number): void {
    if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return;
    this.times[this.next] = dtSeconds;
    this.next = (this.next + 1) % FRAME_WINDOW;
    if (this.count < FRAME_WINDOW) this.count++;
  }

  /** Median and slow-frame rates over the window (nearest-rank percentiles of the frame times). */
  stats(): FrameSummary {
    const n = this.count;
    if (!n) return { n: 0, p50: 0, p5: 0 };
    const s = this.sorted.subarray(0, n);
    s.set(this.times.subarray(0, n));
    s.sort();
    const at = (q: number) => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
    return { n, p50: 1 / at(0.5), p5: 1 / at(0.95) };
  }
}

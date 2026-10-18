// Havok's warm-up waits for an idle page (src/game/warmup.ts): with requestIdleCallback, at most IDLE_BY_MS later;
// without it (Safari), a plain IDLE_BY_MS timeout. Each runs the warm-up once.
import { describe, expect, it } from 'vitest';
import { IDLE_BY_MS, whenIdle, type IdleHost } from '../src/game/warmup.js';

describe('whenIdle', () => {
  it('asks for an idle callback, due at the latest IDLE_BY_MS later, and runs once when it comes', () => {
    const asked: { run: () => void; opts?: { timeout: number } }[] = [];
    const timeouts: number[] = [];
    const host: IdleHost = {
      requestIdleCallback: (run, opts) => { asked.push({ run, opts }); return 1; },
      setTimeout: (_run, ms) => { timeouts.push(ms); return 1; },
    };
    let runs = 0;
    whenIdle(() => runs++, host);
    expect(asked).toHaveLength(1);
    expect(asked[0].opts).toEqual({ timeout: IDLE_BY_MS });
    expect(timeouts).toEqual([]);
    expect(runs).toBe(0);
    asked[0].run();
    expect(runs).toBe(1);
  });

  it('without idle callbacks, waits IDLE_BY_MS (1500 ms)', () => {
    const timeouts: { run: () => void; ms: number }[] = [];
    const host: IdleHost = { setTimeout: (run, ms) => { timeouts.push({ run, ms }); return 1; } };
    let runs = 0;
    whenIdle(() => runs++, host);
    expect(IDLE_BY_MS).toBe(1500);
    expect(timeouts.map(t => t.ms)).toEqual([1500]);
    expect(runs).toBe(0);
    timeouts[0].run();
    expect(runs).toBe(1);
  });
});

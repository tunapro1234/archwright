// ?autotest=...&shots=1 (src/systems/autotest.ts): each key frame is held once in every run, so a second run on the
// same level (w1-1:collapse;w1-1:hold) has its own 'tray', the frame where the last collapse's rings show.
import { describe, expect, it } from 'vitest';
import { AutotestSystem, parseAutotest } from '../src/systems/autotest.js';

describe('autotest key frames', () => {
  it('once per name in each run', () => {
    const sys = Object.create(AutotestSystem.prototype) as AutotestSystem;
    const own = sys as unknown as { shots: boolean; taken: Set<string>; run: number; shot(arch: unknown, name: string): boolean };
    Object.assign(own, { shots: true, taken: new Set<string>(), run: 0 });
    const arch = { hook: { shot: undefined as string | undefined } };
    expect(own.shot(arch, 'tray')).toBe(true);
    expect(arch.hook.shot).toBe('tray');
    expect(own.shot(arch, 'tray')).toBe(false);
    expect(own.shot(arch, 'collapsed')).toBe(true);
    own.run = 1;
    expect(own.shot(arch, 'tray')).toBe(true);
    expect(own.shot(arch, 'tray')).toBe(false);
    expect(own.shot(arch, 'held')).toBe(true);
    own.shots = false;
    own.run = 2;
    expect(own.shot(arch, 'tray')).toBe(false);
  });

  it('two runs on one level parse as two runs', () => {
    expect(parseAutotest('w1-1:collapse;w1-1:hold')).toEqual([
      { level: 'w1-1', outcome: 'collapse' }, { level: 'w1-1', outcome: 'hold' },
    ]);
  });
});

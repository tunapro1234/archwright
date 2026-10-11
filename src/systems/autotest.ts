// ?autotest=<level>:<hold|collapse> plays a level by program, for tests and the video only: it
// seats the level's solution (hold) or its trap (collapse) stone by stone, then pulls the centering.
// It goes through the same placement and strike code as a hand, but it is not a hand simulation.
// Several runs can be chained with ';', e.g. ?autotest=w1-1:hold;w1-1:collapse.
import { createSystem } from '@iwsdk/core';
import { ArchRuntime } from '../game/runtime.js';
import type { Step } from '../game/arch-state.js';

export interface AutotestRun { level: string; outcome: 'hold' | 'collapse' }

export function parseAutotest(param: string | null): AutotestRun[] {
  if (!param) return [];
  return param.split(';').map(s => s.trim()).filter(Boolean).flatMap(s => {
    const [level, outcome] = s.split(':');
    return outcome === 'hold' || outcome === 'collapse' ? [{ level, outcome }] : [];
  });
}

const START_DELAY = 1.0;
const STEP = 0.6;
const MOVE = 0.45;
const BEFORE_PULL = 0.8;
const BETWEEN_RUNS = 3.5;

export class AutotestSystem extends createSystem({}) {
  private runs: AutotestRun[] = [];
  private run = 0;
  private steps: Step[] = [];
  private next = 0;
  private timer = START_DELAY;
  private phase: 'place' | 'pull' | 'verdict' | 'done' = 'place';

  init(): void {
    this.runs = parseAutotest(new URLSearchParams(location.search).get('autotest'));
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state || this.run >= this.runs.length) return;
    this.timer -= delta;
    if (this.timer > 0) return;
    if (this.phase === 'place' && this.steps.length === 0) {
      const r = this.runs[this.run];
      if (arch.def.id !== r.level || arch.state.placed.length > 0) arch.load(ArchRuntime.levelById(r.level));
      this.steps = r.outcome === 'hold' ? arch.def.solution : arch.def.trap;
      this.next = 0;
      this.timer = STEP;
      return;
    }
    switch (this.phase) {
      case 'place': {
        const s = this.steps[this.next++];
        const v = arch.stoneById(s.stone);
        if (!v || arch.place(v, s.side, MOVE, 0.07)) console.warn(`autotest: could not place ${s.stone} on the ${s.side}`);
        this.timer = this.next < this.steps.length ? STEP : BEFORE_PULL;
        if (this.next >= this.steps.length) this.phase = 'pull';
        break;
      }
      case 'pull':
        arch.centering.auto = true;
        this.phase = 'verdict';
        this.timer = 0;
        break;
      case 'verdict':
        if (arch.hook.state === 'held' || arch.hook.state === 'collapsed') {
          this.run++;
          this.steps = [];
          this.phase = this.run < this.runs.length ? 'place' : 'done';
          this.timer = BETWEEN_RUNS;
        }
        break;
    }
  }
}

// ?autotest=<level>:<hold|collapse> plays a level by program, for tests and the video only: it
// seats the level's solution (hold) or its trap (collapse) stone by stone, then pulls the centering.
// It goes through the same placement and strike code as a hand, but it is not a hand simulation.
// Several runs can be chained with ';', e.g. ?autotest=w1-1:hold;w1-1:collapse. In XR (?autoxr) it
// waits for the session and for the board to stand on its surface.
// With &shots=1 it also holds at seven key frames (tray, ghost, keystone, pulling, held,
// collapse-mid, collapsed), naming each in window.__archwright.shot until the test clears it. Slow
// software rendering would otherwise rush past the short moments between two screenshots. For
// 'ghost' the keystone is shown hovering above its gap with the snap ghost lit, as a hand would hold it.
import { createSystem } from '@iwsdk/core';
import { ArchRuntime } from '../game/runtime.js';
import { strikePull } from '../scene/layout.js';
import { SILENCE } from './statics.js';
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
const HELD_SHOT = SILENCE + 1.0;         // the thread has faded in
const MID_SHOT = SILENCE + 0.35;         // the stones are falling
const COLLAPSED_SHOT = SILENCE + 4.0;    // everything has come to rest

export class AutotestSystem extends createSystem({}) {
  private runs: AutotestRun[] = [];
  private run = 0;
  private steps: Step[] = [];
  private next = 0;
  private timer = START_DELAY;
  private phase: 'place' | 'pull' | 'verdict' | 'settle' | 'done' = 'place';
  private settled = 0;
  private shots = false;
  private taken = new Set<string>();
  private resumePull = false;
  /** ?autoxr: the page enters XR by itself, so the run waits for that session. */
  private awaitXR = false;

  init(): void {
    const params = new URLSearchParams(location.search);
    this.runs = parseAutotest(params.get('autotest'));
    this.shots = params.get('shots') === '1';
    this.awaitXR = params.get('emulator') === '1' && !!params.get('autoxr');
  }

  /** Hold for a key frame (once per name). True when the autotest should wait this frame. */
  private shot(arch: ArchRuntime, name: string): boolean {
    if (!this.shots || this.taken.has(name)) return false;
    this.taken.add(name);
    arch.hook.shot = name;
    return true;
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state || this.run >= this.runs.length) return;
    if (arch.hook.shot) return;
    // In XR the board is hidden until SurfaceSystem has found it a surface; nothing goes down before.
    if ((this.awaitXR && !this.renderer.xr.isPresenting) || !arch.shown) return;
    if (this.resumePull) { this.resumePull = false; arch.centering.auto = true; }
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
        if (this.next === 0 && this.shot(arch, 'tray')) return;
        const s = this.steps[this.next];
        const v = arch.stoneById(s.stone);
        if (v && this.next === this.steps.length - 1 && this.shots && !this.taken.has('ghost')) {
          const t = arch.targets(v).find(q => q.side === s.side);
          if (t) {
            v.tween = undefined;
            v.mode = 'held';
            v.pose = { ...t.pose, x: t.pose.x + 0.085, z: t.pose.z + 0.05 }; // beside the gap, the ghost in view
            arch.showGhost('right', v, t.pose, 0.6);
            this.shot(arch, 'ghost');
            return;
          }
        }
        arch.hideGhost('right');
        this.next++;
        if (!v || arch.place(v, s.side, MOVE, 0.07)) console.warn(`autotest: could not place ${s.stone} on the ${s.side}`);
        this.timer = this.next < this.steps.length ? STEP : BEFORE_PULL;
        if (this.next >= this.steps.length) this.phase = 'pull';
        break;
      }
      case 'pull':
        if (arch.stones.some(v => v.mode === 'tween')) break; // let the keystone land first
        if (this.shot(arch, 'keystone')) return;
        arch.centering.auto = true;
        this.phase = 'verdict';
        this.timer = 0;
        break;
      case 'verdict':
        if (!arch.centering.struck && arch.centering.pull > strikePull(arch.def.depth) / 2 && this.shot(arch, 'pulling')) {
          arch.centering.auto = false;
          this.resumePull = true;
          return;
        }
        if (arch.hook.state === 'held' || arch.hook.state === 'collapsed') {
          this.phase = 'settle';
          this.settled = 0;
        }
        break;
      case 'settle': {
        this.settled += delta;
        const t = this.settled;
        if (arch.hook.state === 'held' && t >= HELD_SHOT && this.shot(arch, 'held')) return;
        if (arch.hook.state === 'collapsed' && t >= MID_SHOT && this.shot(arch, 'collapse-mid')) return;
        if (arch.hook.state === 'collapsed' && t >= COLLAPSED_SHOT && this.shot(arch, 'collapsed')) return;
        if (t >= (this.shots ? COLLAPSED_SHOT + 0.5 : BETWEEN_RUNS)) {
          this.run++;
          this.steps = [];
          this.phase = this.run < this.runs.length ? 'place' : 'done';
          this.timer = this.shots ? 0.5 : 0;
        }
        break;
      }
    }
  }
}

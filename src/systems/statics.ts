// The strike: our solver, not the physics engine, decides whether the arch holds. A held arch
// shows its line of thrust as a golden thread; a failed one is handed to CollapseSystem. Before it
// falls, in the silence after the strike, it shows why (src/statics/failure-view.ts): the solver's
// line of thrust dashed in a hot colour, thick where it has left the stones, a ring where it leaves
// them and a crack at each joint the arch breaks at. That drawing fades in FAIL_OUT once the collapse
// is under way, and is freed.
import { createSystem, type Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { buildArch, isClosed, strike } from '../game/arch-state.js';
import { failureMarks, failureStrokes, type FailureMarks } from '../statics/failure-view.js';
import { ABUTMENT_HEIGHT } from '../scene/layout.js';
import { failureMesh, thrustTube } from '../scene/models.js';
import { playChord, playCue } from '../audio/synth.js';
import { archChord, collapseCue, strikeCue } from '../audio/music.js';

export const SILENCE = 0.6; // s between the strike and the verdict being heard and seen
/** The failure marks come up this fast after the strike (s), and go this fast once the stones fall. */
export const FAIL_IN = 0.15;
export const FAIL_OUT = 0.5;
const FAIL_OPACITY = 0.95;

export class StaticsSystem extends createSystem({}) {
  private pending = -1;   // seconds until the verdict plays out
  private glow = 0;
  /** Failure marks: seconds since they appeared, and since the collapse took over (-1 until then). */
  private failIn = 0;
  private failOut = -1;

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;

    if (arch.strikeRequested) {
      arch.strikeRequested = false;
      const { state, result } = strike(arch.state);
      arch.state = state;
      arch.result = result;
      arch.hook.state = result.stands ? 'held' : 'collapsed';
      this.pending = SILENCE;
      this.glow = 0;
      playCue(strikeCue(result.stands));
      if (result.stands && result.thrustLine.length > 1) {
        const pts = result.thrustLine.map(p => ({ x: p.x, y: p.y + ABUTMENT_HEIGHT }));
        arch.thrustLine = thrustTube(pts, arch.def.depth / 2 + 0.003);
        arch.site.add(arch.thrustLine);
      }
      this.showFailure(arch);
    }

    if (this.pending >= 0) {
      this.pending -= delta;
      if (this.pending < 0 && arch.result) {
        if (arch.result.stands) playChord(archChord(arch.state));
        else {
          playCue(collapseCue(arch.state.placed.length, seedOf(arch.state.level)));
          arch.collapseRequested = true;
        }
      }
    }
    if (arch.thrustLine && this.pending < 0 && this.glow < 1) {
      this.glow = Math.min(1, this.glow + delta / 0.8);
      ((arch.thrustLine as Mesh).material as MeshBasicMaterial).opacity = 0.95 * this.glow;
    }
    if (arch.failureMarks) this.fadeFailure(arch, delta);
  }

  /** After a strike: note why it fell in the hook and, when it fell, draw it (invisible until fadeFailure). */
  private showFailure(arch: ArchRuntime): void {
    const result = arch.result!;
    // An open arch has no line of thrust and no joints to name; it is reported as a hinge, like the solver's verdict.
    const arc = isClosed(arch.state) ? buildArch(arch.state) : null;
    const marks: FailureMarks = arc
      ? failureMarks(result, arc)
      : { kind: result.stands ? 'none' : result.failure ?? 'hinge', line: null, outside: [], joints: [] };
    arch.hook.failure = { kind: marks.kind, outside: [...marks.outside], joints: [...marks.joints] };
    if (!arc || marks.kind === 'none') return;
    const strokes = failureStrokes(marks, arc);
    if (!strokes.length) return;
    arch.failureMarks = failureMesh(strokes, arch.def.depth / 2 + 0.004);
    arch.failureMarks.position.y = ABUTMENT_HEIGHT;
    arch.site.add(arch.failureMarks);
    this.failIn = 0;
    this.failOut = -1;
  }

  /** Up in FAIL_IN during the silence; once CollapseSystem has taken the stones, down in FAIL_OUT, then removed and freed. */
  private fadeFailure(arch: ArchRuntime, delta: number): void {
    const m = arch.failureMarks!;
    const mat = m.material as MeshBasicMaterial;
    this.failIn += delta;
    if (this.failOut < 0 && this.pending < 0 && !arch.collapseRequested) this.failOut = 0;
    if (this.failOut >= 0) this.failOut += delta;
    const up = Math.min(1, this.failIn / FAIL_IN);
    const down = this.failOut < 0 ? 1 : Math.max(0, 1 - this.failOut / FAIL_OUT);
    mat.opacity = FAIL_OPACITY * Math.min(up, down);
    if (down > 0) return;
    m.removeFromParent();
    m.geometry.dispose();
    mat.dispose();
    arch.failureMarks = undefined;
  }
}

/** The same level always falls to the same sound (FNV-1a of its id). */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

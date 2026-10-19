// The strike: our solver, not the physics engine, decides whether the arch holds. A held arch
// shows its line of thrust as a golden thread; a failed one is handed to CollapseSystem. Before it
// falls, in the silence after the strike, it shows why (src/statics/failure-view.ts): the solver's
// line of thrust dashed in a hot colour, thick where it has left the stones, a ring where it leaves
// them and a crack at each joint the arch breaks at. Once the collapse is under way that drawing fades in
// FAIL_OUT to FAIL_REST and stays there, faint, over the fallen stones, until the level is cleared (rebuild,
// next level): ArchRuntime.clear() removes and frees it with the rest of the level. What stays of it is the joints it
// broke at (rememberFall): built again, the same level marks each with a small ring until the next strike.
import { createSystem, type Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { buildArch, isClosed, strike } from '../game/arch-state.js';
import { failureMarks, failureStrokes, rememberFall, STROKE, type FailureMarks } from '../statics/failure-view.js';
import { ABUTMENT_HEIGHT, PIER_EXTRA } from '../scene/layout.js';
import { failureMesh, thrustTube } from '../scene/models.js';
import { freeObjects } from '../scene/free.js';
import { playChord, playCue } from '../audio/synth.js';
import { archChord, collapseCue, strikeCue } from '../audio/music.js';

export const SILENCE = 0.6; // s between the strike and the verdict being heard and seen
/** The failure marks come up this fast after the strike (s), and fade this fast once the stones fall. */
export const FAIL_IN = 0.15;
export const FAIL_OUT = 0.5;
const FAIL_OPACITY = 0.95;
/** The failure marks' opacity once the stones have fallen: still there to look at, behind the stones' story. */
export const FAIL_REST = 0.35;

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
      this.forgetRings(arch);
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
    arch.fall = rememberFall(arch.def.id, marks, arc);
    if (!arc || marks.kind === 'none') return;
    const strokes = failureStrokes(marks, arc);
    if (!strokes.length) return;
    // In front of the piers, not just the stones: the springing joints lie on the pier tops.
    arch.failureMarks = failureMesh(strokes, (arch.def.depth + PIER_EXTRA) / 2 + STROKE.outside + 0.001);
    arch.failureMarks.position.y = ABUTMENT_HEIGHT;
    arch.site.add(arch.failureMarks);
    arch.hook.marks = 0;
    this.failIn = 0;
    this.failOut = -1;
  }

  /** A strike takes down the last collapse's rings: this one's own marks (or a held arch) say what is true now. */
  private forgetRings(arch: ArchRuntime): void {
    arch.hook.failureMemory = null;
    if (!arch.memoryRings) return;
    arch.site.remove(arch.memoryRings);
    freeObjects([arch.memoryRings], new Set());
    arch.memoryRings = undefined;
  }

  /** Up in FAIL_IN during the silence; once CollapseSystem has taken the stones, down to FAIL_REST in FAIL_OUT, and
   *  kept: the level's clear() frees them. */
  private fadeFailure(arch: ArchRuntime, delta: number): void {
    const mat = arch.failureMarks!.material as MeshBasicMaterial;
    this.failIn += delta;
    if (this.failOut < 0 && this.pending < 0 && !arch.collapseRequested) this.failOut = 0;
    if (this.failOut >= 0) this.failOut += delta;
    const up = Math.min(1, this.failIn / FAIL_IN);
    const down = this.failOut < 0 ? 0 : Math.min(1, this.failOut / FAIL_OUT);
    mat.opacity = up * (FAIL_OPACITY + (FAIL_REST - FAIL_OPACITY) * down);
    arch.hook.marks = mat.opacity;
  }
}

/** The same level always falls to the same sound (FNV-1a of its id). */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

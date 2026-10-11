// The strike: our solver, not the physics engine, decides whether the arch holds. A held arch
// shows its line of thrust as a golden thread; a failed one is handed to CollapseSystem.
import { createSystem, type Mesh, type MeshBasicMaterial } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { strike } from '../game/arch-state.js';
import { ABUTMENT_HEIGHT } from '../scene/layout.js';
import { thrustTube } from '../scene/meshes.js';
import { playCollapse, playHold } from '../audio/synth.js';

export const SILENCE = 0.6; // s between the strike and the verdict being heard and seen

export class StaticsSystem extends createSystem({}) {
  private pending = -1;   // seconds until the verdict plays out
  private glow = 0;

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
      if (result.stands && result.thrustLine.length > 1) {
        const pts = result.thrustLine.map(p => ({ x: p.x, y: p.y + ABUTMENT_HEIGHT }));
        arch.thrustLine = thrustTube(pts, arch.def.depth / 2 + 0.003);
        arch.site.add(arch.thrustLine);
      }
    }

    if (this.pending >= 0) {
      this.pending -= delta;
      if (this.pending < 0 && arch.result) {
        if (arch.result.stands) playHold();
        else { playCollapse(); arch.collapseRequested = true; }
      }
    }
    if (arch.thrustLine && this.pending < 0 && this.glow < 1) {
      this.glow = Math.min(1, this.glow + delta / 0.8);
      ((arch.thrustLine as Mesh).material as MeshBasicMaterial).opacity = 0.95 * this.glow;
    }
  }
}

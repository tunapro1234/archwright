// The wooden centering slides out towards the player by its handle, with one hand or both. Once it
// clears the stones the arch is struck; after that it slides on to the end of its travel and is
// taken away (it fades out), so the arch, or its collapse, is in full view.
import { createSystem, Vector3, type MeshStandardMaterial } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import { CENTERING, strikePull } from '../scene/layout.js';
import { playScrape } from '../audio/synth.js';

export const HANDLE_RADIUS = 0.06;
export const AUTO_PULL_SPEED = 0.07; // m/s, autotest only
const FADE = 0.5;                    // s for the struck centering to fade out

export class CenteringSystem extends createSystem({}) {
  private grip: Record<Side, { z0: number; pull0: number } | undefined> = { left: undefined, right: undefined };
  private local = new Vector3();
  private hp = new Vector3();
  private scraped = false;

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    if (!arch?.centering || !hands) return;
    const c = arch.centering;
    const usable = arch.state.placed.length > 0 && !c.struck;

    let pull = c.pull;
    let gripped = false;
    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      if (this.grip[side] && (!usable || h.pinchEnded || !h.tracked)) this.grip[side] = undefined;
      if (!usable || !h.tracked) continue;
      arch.site.worldToLocal(this.local.copy(h.point));
      if (!this.grip[side] && h.pinchStarted) {
        c.handle.getWorldPosition(this.hp);
        if (this.hp.distanceTo(h.point) < HANDLE_RADIUS) this.grip[side] = { z0: this.local.z, pull0: c.pull };
      }
      const g = this.grip[side];
      if (g) {
        // With two hands the one that has pulled further leads; pushing back is allowed until the strike.
        const p = g.pull0 + (this.local.z - g.z0);
        pull = gripped ? Math.max(pull, p) : p;
        gripped = true;
      }
    }
    if (c.auto && usable) pull = c.pull + AUTO_PULL_SPEED * delta;
    if (c.struck) pull = c.pull + (CENTERING.maxPull - c.pull) * Math.min(1, delta * 3);

    c.pull = Math.max(0, Math.min(CENTERING.maxPull, pull));
    if (c.pull > 0.004 && !this.scraped) { this.scraped = true; playScrape(); }
    if (c.pull < 0.002) this.scraped = false;
    c.mesh.position.z = c.pull;
    if (c.struck && c.mesh.visible) {
      const mat = c.mesh.material as MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = Math.max(0, mat.opacity - delta / FADE);
      if (mat.opacity === 0) c.mesh.visible = false;
    }

    if (!c.struck && c.pull >= strikePull(arch.def.depth)) {
      c.struck = true;
      c.auto = false;
      this.grip.left = this.grip.right = undefined;
      arch.strikeRequested = true;
    }
  }
}

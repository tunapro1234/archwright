// Visual sync: stone poses -> proxy transforms -> one instanced draw per stone shape, the pinch
// cursors, and the performance numbers for window.__archwright.
import { createSystem, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { PALETTE } from '../scene/palette.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';

export class StoneRenderSystem extends createSystem({}) {
  private m = new Matrix4();
  private cursors: Record<Side, Mesh> | undefined;
  private idle = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false });
  private active = new MeshBasicMaterial({ color: PALETTE.pinch, transparent: true, opacity: 0.9, depthTest: false });

  init(): void {
    const g = new SphereGeometry(0.006, 12, 8);
    const make = (side: Side) => {
      const c = new Mesh(g, this.idle);
      c.name = `pinch-cursor-${side}`;
      c.visible = false;
      c.renderOrder = 10;
      this.world.createTransformEntity(c, { persistent: true });
      return c;
    };
    this.cursors = { left: make('left'), right: make('right') };
  }

  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    if (hands && this.cursors) {
      for (const side of ['left', 'right'] as const) {
        const c = this.cursors[side], h = hands[side];
        c.visible = h.tracked;
        if (h.tracked) { c.position.copy(h.point); c.material = h.pinching ? this.active : this.idle; }
      }
    }
    if (!arch?.stones.length) return;
    for (const v of arch.stones) {
      if (v.mode !== 'dynamic') arch.applyPose(v.mesh, v.pose);
      v.mesh.updateMatrix();
      v.mesh.updateMatrixWorld();
      const b = arch.batches[v.batch].mesh;
      b.setMatrixAt(v.slot, this.m.copy(v.mesh.matrixWorld));
    }
    for (const b of arch.batches) b.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Runs first each frame: marks the start of the JS frame. */
export class PerfStartSystem extends createSystem({}) {
  update(): void {
    this.globals.frameStart = performance.now();
  }
}

/** Runs last each frame: frame rate, JS time per frame, and the last rendered frame's counts. */
export class PerfEndSystem extends createSystem({}) {
  private fps = 0;
  private ms = 0;

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch) return;
    const js = performance.now() - (this.globals.frameStart as number ?? performance.now());
    const k = 0.1;
    if (delta > 0) this.fps = this.fps ? this.fps + (1 / delta - this.fps) * k : 1 / delta;
    this.ms = this.ms ? this.ms + (js - this.ms) * k : js;
    const p = arch.hook.perf;
    p.fps = Math.round(this.fps * 10) / 10;
    p.frameMs = Math.round(this.ms * 100) / 100;
    p.drawCalls = this.renderer.info.render.calls;
    p.triangles = this.renderer.info.render.triangles;
    p.bodies = arch.bodies;
  }
}

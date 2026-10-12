// World 3: a load waits on the board behind the arch until a stone covers its course, then comes
// down onto the middle of that stone's back in a short arc. If the stone is lifted off again, the
// load goes back to the board. When the arch falls, a load that stands on a stone keeps its place on
// it and tumbles with it. The solver does not wait for any of this: strike() puts every load on its
// stone (arch-state.ts), this system only shows it.
import { createSystem, Matrix4, Vector3 } from '@iwsdk/core';
import type { ArchRuntime, LoadView, StoneView } from '../game/runtime.js';
import { stoneAt } from '../game/arch-state.js';
import { stoneBack } from '../scene/layout.js';

const DESCENT = 0.5; // s from the board onto the stone
const LIFT = 0.05;   // m, height of the arc on the way

const ease = (t: number) => t * t * (3 - 2 * t);

export class LoadSystem extends createSystem({}) {
  private from = new Vector3();
  private m = new Matrix4();

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.loads.length) return;
    for (const l of arch.loads) {
      const p = stoneAt(arch.state, l.def.course);
      const v = p ? arch.stoneById(p.stone.id) : undefined;
      if (v?.mode === 'dynamic' && l.on > 0 && l.stone === v.def.id) { this.ride(l, v); continue; }
      l.ride = undefined;
      const seated = v?.mode === 'placed';
      if (seated) {
        l.stone = v.def.id;
        const back = stoneBack(arch.state.geometry, v.def);
        v.mesh.localToWorld(l.top.set(back.x, back.y, 0));
      }
      l.on = Math.min(1, Math.max(0, l.on + ((seated ? 1 : -1) * delta) / DESCENT));
      if (l.on === 0) l.stone = undefined;
      arch.siteToWorld({ ...l.rest, angle: 0, tilt: 0 }, this.from);
      const t = ease(l.on);
      l.mesh.position.lerpVectors(this.from, l.top, t);
      l.mesh.position.y += LIFT * Math.sin(Math.PI * t);
      arch.site.getWorldQuaternion(l.mesh.quaternion); // upright, facing along the arch
    }
  }

  /** Keep the load's transform relative to its falling stone (the stone's matrix is current: render runs first). */
  private ride(l: LoadView, v: StoneView): void {
    if (!l.ride) {
      l.mesh.updateMatrixWorld();
      l.ride = new Matrix4().copy(v.mesh.matrixWorld).invert().multiply(l.mesh.matrixWorld);
    }
    this.m.multiplyMatrices(v.mesh.matrixWorld, l.ride);
    this.m.decompose(l.mesh.position, l.mesh.quaternion, l.mesh.scale);
  }
}

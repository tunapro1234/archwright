// When the solver says the arch fails, the placed stones become Havok rigid bodies and the arch
// opens at the joints the solver named, like the hinges of a real collapse. Physics is registered
// lazily (when the first stone is placed), so Havok's WASM is not part of the first load.
import {
  BoxGeometry, createSystem, Mesh, MeshBasicMaterial, PhysicsBody, PhysicsManipulation, PhysicsShape,
  PhysicsShapeType, PhysicsState, PhysicsSystem, Quaternion, Vector3, type Entity,
} from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import { MATERIAL_DENSITY, ringOrder } from '../game/arch-state.js';
import { abutments, ABUTMENT_HEIGHT, BOARD } from '../scene/layout.js';

export const MAX_BODIES = 40;
const SPIN = 1.6;      // rad/s, initial rotation of a segment about its hinge
const DROP = 0.25;     // m/s, initial drop of the crown segment

interface Kick { entity: Entity; v: Vector3; w: Vector3; tries: number }

export class CollapseSystem extends createSystem({}) {
  private kicks: Kick[] = [];
  private frame = 0;
  private generation = -1;
  private proxy = new MeshBasicMaterial({ visible: false });

  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    if (arch.generation !== this.generation) { this.generation = arch.generation; this.kicks = []; }
    if (!arch.physicsRegistered && arch.state.placed.length > 0) this.registerPhysics(arch);
    if (arch.collapseRequested && arch.physicsRegistered) {
      arch.collapseRequested = false;
      this.begin(arch);
    }
    this.frame++;
    // Bodies are created asynchronously; keep offering the kick until the body has picked it up.
    for (let i = this.kicks.length - 1; i >= 0; i--) {
      const k = this.kicks[i];
      if (this.frame % 3 !== 0) continue;
      const lv = k.entity.getVectorView(PhysicsBody, '_linearVelocity');
      if ((lv[0] !== 0 || lv[1] !== 0 || lv[2] !== 0) || k.tries > 12) { this.kicks.splice(i, 1); continue; }
      k.tries++;
      if (!k.entity.hasComponent(PhysicsManipulation)) {
        k.entity.addComponent(PhysicsManipulation, {
          linearVelocity: [k.v.x, k.v.y, k.v.z],
          angularVelocity: [k.w.x, k.w.y, k.w.z],
        });
      }
    }
    arch.hook.perf.bodies = arch.bodies;
  }

  private registerPhysics(arch: ArchRuntime): void {
    arch.physicsRegistered = true;
    if (this.world.hasSystem(PhysicsSystem)) return;
    this.world
      .registerComponent(PhysicsBody)
      .registerComponent(PhysicsShape)
      .registerComponent(PhysicsManipulation)
      .registerSystem(PhysicsSystem, { priority: -2 });
  }

  private begin(arch: ArchRuntime): void {
    const def = arch.def;
    const site = arch.site;
    const q = site.getWorldQuaternion(new Quaternion());
    const box = (w: number, h: number, d: number, local: Vector3) => {
      if (arch.bodies >= MAX_BODIES) return;
      const m = new Mesh(new BoxGeometry(w, h, d), this.proxy);
      m.position.copy(site.localToWorld(local.clone()));
      m.quaternion.copy(q);
      const e = arch.own(this.world.createTransformEntity(m));
      e.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [w, h, d], friction: 0.7, restitution: 0.05 });
      e.addComponent(PhysicsBody, { state: PhysicsState.Static });
      arch.bodies++;
    };
    // Board, abutments and the floor (local-floor puts it at y = 0).
    box(BOARD.width, BOARD.thickness, BOARD.zMax - BOARD.zMin, new Vector3(0, -BOARD.thickness / 2, (BOARD.zMin + BOARD.zMax) / 2));
    for (const a of abutments(def)) box(a.width, a.height, def.depth + 0.012, new Vector3(a.x, a.height / 2, 0));
    const floor = new Mesh(new BoxGeometry(6, 0.1, 6), this.proxy);
    floor.position.set(site.getWorldPosition(new Vector3()).x, -0.05, site.getWorldPosition(new Vector3()).z);
    const fe = arch.own(this.world.createTransformEntity(floor));
    fe.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [6, 0.1, 6], friction: 0.8 });
    fe.addComponent(PhysicsBody, { state: PhysicsState.Static });
    arch.bodies++;

    // Stones still in the tray are obstacles; stones in the arch fall.
    for (const v of arch.stones) {
      if (v.mode === 'tray' && arch.bodies < MAX_BODIES) this.body(arch, v, PhysicsState.Static);
    }
    const order = ringOrder(arch.state);
    const views = order.map(p => arch.stoneById(p.stone.id)!);
    const kicks = this.hingeKicks(arch, views);
    views.forEach((v, i) => {
      if (arch.bodies >= MAX_BODIES) return;
      this.body(arch, v, PhysicsState.Dynamic);
      v.mode = 'dynamic';
      const k = kicks[i];
      this.kicks.push({ entity: v.entity, v: k.v.applyQuaternion(q), w: k.w.applyQuaternion(q), tries: 0 });
    });
  }

  private body(arch: ArchRuntime, v: StoneView, state: (typeof PhysicsState)[keyof typeof PhysicsState]): void {
    v.entity.addComponent(PhysicsShape, {
      shape: PhysicsShapeType.ConvexHull,
      density: MATERIAL_DENSITY[v.def.material],
      friction: 0.6,
      restitution: 0.05,
    });
    v.entity.addComponent(PhysicsBody, { state, linearDamping: 0.05, angularDamping: 0.1 });
    arch.bodies++;
  }

  /**
   * Initial motion that opens the arch at the solver's critical joints: the stones between two
   * hinges move as one segment; the segment over the crown drops, the side segments rotate
   * outwards about their springing-side hinge. Vectors are in the arch (site) frame.
   */
  private hingeKicks(arch: ArchRuntime, views: StoneView[]): { v: Vector3; w: Vector3 }[] {
    const r = arch.result;
    const n = views.length;
    const line = r?.thrustLine ?? [];
    const hinges = [...new Set([0, ...(r?.criticalJoints ?? []), n])].filter(j => j >= 0 && j <= n).sort((a, b) => a - b);
    const out: { v: Vector3; w: Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const v = views[i];
      let a = 0, b = n;
      for (let h = 0; h + 1 < hinges.length; h++) if (i >= hinges[h] && i < hinges[h + 1]) { a = hinges[h]; b = hinges[h + 1]; }
      const midX = (views[a].pose.x + views[b - 1].pose.x) / 2;
      const crownSeg = (views[a].pose.x <= 0.001 && views[b - 1].pose.x >= -0.001) || Math.abs(midX) < arch.def.span * 0.08;
      if (crownSeg || line.length < n + 1) {
        out.push({ v: new Vector3(0, -DROP, 0), w: new Vector3() });
        continue;
      }
      const left = midX < 0;
      const hinge = line[left ? a : b];
      const w = left ? SPIN : -SPIN;  // left side turns counter-clockwise (its top moves outwards)
      const dx = v.pose.x - hinge.x, dy = v.pose.y - (hinge.y + ABUTMENT_HEIGHT);
      out.push({ v: new Vector3(-w * dy, w * dx, 0), w: new Vector3(0, 0, w) });
    }
    return out;
  }
}

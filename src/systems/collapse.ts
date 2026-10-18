// When the solver says the arch fails, the placed stones become Havok rigid bodies and the arch
// opens at the joints the solver named, like the hinges of a real collapse. Physics is registered
// lazily, so Havok's WASM is not part of the first load: once the board has first been shown, when the page
// is idle (src/game/warmup.ts), or at the first stone if that comes sooner. __archwright.physics says when it
// was registered and when Havok was ready (performance.now ms).
// They fall onto the board, the abutments, any stone left in the tray, the desk under the board (a detected
// desk or the atelier's, one static box turned as the desk stands) and the floor. Once they have come to rest,
// __archwright.collapse.rest counts where; __archwright.collapse.simTime is the game time it has run.
import {
  BoxGeometry, createSystem, Mesh, MeshBasicMaterial, PhysicsBody, PhysicsManipulation, PhysicsShape,
  PhysicsShapeType, PhysicsState, PhysicsSystem, Quaternion, Vector3, type Entity,
} from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import { restPlace, type CollapseRest } from '../game/rest.js';
import { MATERIAL_DENSITY, ringOrder } from '../game/arch-state.js';
import { abutments, ABUTMENT_HEIGHT, BOARD } from '../scene/layout.js';
import { SILENCE } from './statics.js';
import { whenIdle } from '../game/warmup.js';

export const MAX_BODIES = 40;
const SPIN = 1.6;      // rad/s, initial rotation of a segment about its hinge
const DROP = 0.25;     // m/s, initial drop of the crown segment
/** Game seconds a kick is offered for while its body is still being created. */
const KICK_FOR = 5;
const DESK_THICK = 0.04;
const DESK_FRICTION = 0.8;
/** At rest: every falling stone slower than this (m/s) for REST_HOLD s; or REST_BY s after the strike, whichever first. */
const REST_SPEED = 0.02;
const REST_HOLD = 0.5;
const REST_BY = 6;

interface Kick { entity: Entity; v: Vector3; w: Vector3; left: number }

export class CollapseSystem extends createSystem({}) {
  private kicks: Kick[] = [];
  private frame = 0;
  private generation = -1;
  private proxy = new MeshBasicMaterial({ visible: false });
  /** The stones falling in the collapse under way, until they are counted at rest. */
  private falling: StoneView[] = [];
  private since = 0;
  private quiet = 0;
  /** A collapse is running on this level: its simTime counts. */
  private live = false;
  private w = new Vector3();
  private l = new Vector3();
  /** Havok warm-up: asked for once the board has been shown, due once the page has been idle since. */
  private warmAsked = false;
  private warmDue = false;

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    if (arch.generation !== this.generation) { this.generation = arch.generation; this.kicks = []; this.falling = []; this.live = false; }
    if (!arch.physicsRegistered) this.warmUp(arch);
    else if (arch.hook.physics.ready === null) this.watchReady(arch);
    if (arch.collapseRequested && arch.physicsRegistered) {
      arch.collapseRequested = false;
      this.begin(arch);
    }
    this.frame++;
    if (this.live) arch.hook.collapse!.simTime += delta;
    // Bodies are created asynchronously; keep offering the kick until the body has picked it up, for KICK_FOR
    // seconds of game time at most (a slow frame or a slow physics start does not use the offer up).
    for (let i = this.kicks.length - 1; i >= 0; i--) {
      const k = this.kicks[i];
      k.left -= delta;
      const lv = k.entity.getVectorView(PhysicsBody, '_linearVelocity');
      if ((lv[0] !== 0 || lv[1] !== 0 || lv[2] !== 0) || k.left <= 0) { this.kicks.splice(i, 1); continue; }
      if (this.frame % 3 !== 0) continue;
      if (!k.entity.hasComponent(PhysicsManipulation)) {
        k.entity.addComponent(PhysicsManipulation, {
          linearVelocity: [k.v.x, k.v.y, k.v.z],
          angularVelocity: [k.w.x, k.w.y, k.w.z],
        });
      }
    }
    if (this.falling.length) this.watchRest(arch, delta);
    arch.hook.perf.bodies = arch.bodies;
  }

  /** Count the falling stones once they are at rest (or REST_BY s after the strike): on the board, on the desk, below. */
  private watchRest(arch: ArchRuntime, delta: number): void {
    this.since += delta;
    // Moving only counts once every kick has been taken up: a body not yet made reads a speed of 0.
    let moving = this.kicks.length > 0;
    for (const v of this.falling) {
      if (moving) break;
      const lv = v.entity.getVectorView(PhysicsBody, '_linearVelocity');
      if (Math.hypot(lv[0], lv[1], lv[2]) >= REST_SPEED) moving = true;
    }
    this.quiet = moving ? 0 : this.quiet + delta;
    if (this.quiet < REST_HOLD && this.since < REST_BY) return;
    const rest: CollapseRest = { stones: this.falling.length, onBoard: 0, onDesk: 0, below: 0, settledAfter: Math.round(this.since * 100) / 100 };
    for (const v of this.falling) {
      v.mesh.getWorldPosition(this.w);
      rest[restPlace(arch.site.worldToLocal(this.l.copy(this.w)), this.w, arch.desk)]++;
    }
    (arch.hook.collapse ??= { rest: null, simTime: 0 }).rest = rest;
    this.falling = [];
  }

  /** Register physics when it is due. Here, not in the idle callback, so a pause still holds it back. */
  private warmUp(arch: ArchRuntime): void {
    if (!this.warmAsked && arch.shown && arch.hook.state !== 'loading') {
      this.warmAsked = true;
      whenIdle(() => { this.warmDue = true; });
    }
    if (this.warmDue || arch.state!.placed.length > 0) this.registerPhysics(arch);
  }

  /** Havok is ready once its transport says so (PhysicsSystem keeps that private). */
  private watchReady(arch: ArchRuntime): void {
    const sys = this.world.getSystem(PhysicsSystem) as unknown as { transportReady?: boolean } | undefined;
    if (sys?.transportReady) arch.hook.physics.ready = performance.now();
  }

  private registerPhysics(arch: ArchRuntime): void {
    arch.physicsRegistered = true;
    arch.hook.physics.registered = performance.now();
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
    // The desk under the board: its top level with the desk's, turned as the desk stands.
    const d = arch.desk;
    if (d && arch.bodies < MAX_BODIES) {
      const top = new Mesh(new BoxGeometry(d.width, DESK_THICK, d.depth), this.proxy);
      top.position.set(d.cx, d.y - DESK_THICK / 2, d.cz);
      top.rotation.set(0, d.yaw, 0);
      const de = arch.own(this.world.createTransformEntity(top));
      de.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [d.width, DESK_THICK, d.depth], friction: DESK_FRICTION });
      de.addComponent(PhysicsBody, { state: PhysicsState.Static });
      arch.bodies++;
    }

    // Stones still in the tray are obstacles; stones in the arch fall.
    for (const v of arch.stones) {
      if (v.mode === 'tray' && arch.bodies < MAX_BODIES) this.body(arch, v, PhysicsState.Static);
    }
    const order = ringOrder(arch.state);
    const views = order.map(p => arch.stoneById(p.stone.id)!);
    const kicks = this.hingeKicks(arch, views);
    const hook = (arch.hook.collapse ??= { rest: null, simTime: 0 });
    hook.rest = null;
    hook.simTime = 0;
    this.live = true;
    this.falling = [];
    // The verdict comes SILENCE after the strike: the rest clock counts from the strike.
    this.since = SILENCE;
    this.quiet = 0;
    views.forEach((v, i) => {
      if (arch.bodies >= MAX_BODIES) return;
      this.body(arch, v, PhysicsState.Dynamic);
      v.mode = 'dynamic';
      this.falling.push(v);
      const k = kicks[i];
      this.kicks.push({ entity: v.entity, v: k.v.applyQuaternion(q), w: k.w.applyQuaternion(q), left: KICK_FOR });
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

// The live level: game state, the entities that show it, and the browser hook. Systems read and
// drive it through world.globals.arch; the rules themselves stay in arch-state.ts.
import {
  Color, DirectionalLight, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3,
  type Entity, type World,
} from '@iwsdk/core';
import {
  createLevel, placeStone, takeBack, whyNot, type GameState, type LevelDef, type Side, type StoneDef,
} from './arch-state.js';
import type { SolveResult } from '../statics/index.js';
import { LEVELS } from '../levels/index.js';
import {
  abutments, ABUTMENT_HEIGHT, BOARD, facePose, intrados, stoneOutline, trayPoses, type Pose2,
} from '../scene/layout.js';
import {
  abutmentMaterial, blobShadow, boardMesh, centeringMesh, flatMaterial, ghostColor, ghostMesh, prism, stoneMaterial,
  woodMaterial,
} from '../scene/models.js';
import { MATERIAL_COLOR } from '../scene/meshes.js';
import { PALETTE } from '../scene/palette.js';
import { playReject, playTick } from '../audio/synth.js';

export type HookState = 'loading' | 'ready' | 'building' | 'held' | 'collapsed';
export interface Hook {
  state: HookState;
  level: string;
  perf: { fps: number; frameMs: number; drawCalls: number; triangles: number; bodies: number };
  /** ?autotest with &shots=1 only: name of the key frame the autotest is holding for; clear it to go on. */
  shot?: string;
}

export type StoneMode = 'tray' | 'held' | 'tween' | 'placed' | 'dynamic';

export interface Tween {
  from: Pose2; to: Pose2; t: number; dur: number; lift: number; then: StoneMode;
}

export interface StoneView {
  def: StoneDef;
  entity: Entity;
  mesh: Mesh;             // invisible proxy: carries the transform and the collision geometry
  batch: number;          // index into runtime.batches
  slot: number;           // instance index within that batch
  mode: StoneMode;
  home: Pose2;            // tray pose (site frame)
  pose: Pose2;            // current pose (site frame), unused once dynamic
  tween?: Tween;
  heldBy?: Side;
}

export interface Batch { mesh: InstancedMesh; count: number }

const tmpV = new Vector3();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const xAxis = new Vector3(1, 0, 0);
const zAxis = new Vector3(0, 0, 1);

export class ArchRuntime {
  readonly hook: Hook;
  def!: LevelDef;
  state!: GameState;
  /** Board root: placed on the desk (or lap tray) by SurfaceSystem. */
  readonly site: Group;
  siteEntity!: Entity;
  stones: StoneView[] = [];
  batches: Batch[] = [];
  centering!: { mesh: Mesh; handle: Object3D; pull: number; struck: boolean; auto: boolean };
  thrustLine?: Mesh;
  result?: SolveResult;
  /** Set by CenteringSystem (or autotest) when the centering clears the stones. */
  strikeRequested = false;
  /** Set by StaticsSystem when the verdict is "collapse"; CollapseSystem hands the stones to physics. */
  collapseRequested = false;
  /** Bumped on every load, so systems can drop per-level bookkeeping. */
  generation = 0;
  physicsRegistered = false;
  bodies = 0;
  private levelEntities: Entity[] = [];
  private readonly stoneMat = stoneMaterial();
  private readonly abutmentMat = abutmentMaterial(this.stoneMat);
  private readonly woodMat = woodMaterial();
  private readonly boardMat = flatMaterial(PALETTE.board);
  /** Snap ghosts, one per hand: where the stone that hand holds would seat. */
  private readonly ghosts: Record<Side, Mesh>;
  private readonly proxyMat = new MeshBasicMaterial({ visible: false });

  constructor(readonly world: World) {
    this.hook = {
      state: 'loading',
      level: '',
      perf: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0 },
    };
    (window as unknown as { __archwright: Hook }).__archwright = this.hook;
    this.site = new Group();
    this.site.name = 'site';
    this.site.position.set(0, 0.75, -0.5);
    this.siteEntity = world.createTransformEntity(this.site, { persistent: true });
    const sun = new DirectionalLight(0xffffff, 1.2);
    sun.position.set(0.4, 1.0, 0.6);
    this.site.add(sun);
    this.ghosts = { left: ghostMesh('ghost-left'), right: ghostMesh('ghost-right') };
    for (const g of Object.values(this.ghosts)) world.createTransformEntity(g, { persistent: true });
  }

  static levelById(id: string | null): LevelDef {
    return LEVELS.find(l => l.id === id) ?? LEVELS[0];
  }

  /** Build the level on the board. Safe to call again to restart or switch level. */
  load(def: LevelDef): void {
    this.clear();
    this.def = def;
    this.state = createLevel(def);
    this.result = undefined;
    this.strikeRequested = false;
    this.collapseRequested = false;
    this.bodies = 0;
    this.generation++;
    this.hook.level = def.id;

    const add = (o: Object3D) => { this.site.add(o); return o; };
    add(boardMesh(this.boardMat));
    add(blobShadow(def.span + 0.16, def.depth + 0.14)).position.set(0, 0.0006, 0);
    for (const a of abutments(def)) {
      const m = new Mesh(prism([
        { x: -a.width / 2, y: 0 }, { x: a.width / 2, y: 0 }, { x: a.width / 2, y: a.height }, { x: -a.width / 2, y: a.height },
      ], def.depth + 0.012, 0.002), this.abutmentMat);
      m.name = 'abutment';
      m.position.set(a.x, 0, 0);
      add(m);
    }
    this.woodMat.transparent = false;
    this.woodMat.opacity = 1;
    const cm = centeringMesh(intrados(def.span, def.rise, 32), def.depth, this.woodMat);
    cm.position.set(0, ABUTMENT_HEIGHT, 0);
    add(cm);
    this.centering = { mesh: cm, handle: cm.getObjectByName('centering-handle')!, pull: 0, struck: false, auto: false };

    // One InstancedMesh per stone shape, all sharing the stone material; colour per instance.
    const homes = trayPoses(def);
    const shapes = new Map<string, number>();
    const counts: number[] = [];
    const geos: Mesh['geometry'][] = [];
    const geo = this.state.geometry;
    def.tray.forEach(s => {
      const key = `${s.t}|${s.units}`;
      if (!shapes.has(key)) {
        shapes.set(key, geos.length);
        geos.push(prism(stoneOutline(geo, s), def.depth));
        counts.push(0);
      }
      counts[shapes.get(key)!]++;
    });
    this.batches = geos.map((g, i) => {
      const mesh = new InstancedMesh(g, this.stoneMat, counts[i]);
      mesh.name = `stones-${i}`;
      mesh.frustumCulled = false; // instances move all over the desk when the arch falls
      this.levelEntities.push(this.world.createTransformEntity(mesh));
      return { mesh, count: 0 };
    });
    def.tray.forEach((s, i) => {
      const b = shapes.get(`${s.t}|${s.units}`)!;
      const batch = this.batches[b];
      const mesh = new Mesh(batch.mesh.geometry, this.proxyMat);
      mesh.name = `stone-${s.id}`;
      const entity = this.world.createTransformEntity(mesh);
      this.levelEntities.push(entity);
      const slot = batch.count++;
      batch.mesh.setColorAt(slot, new Color(MATERIAL_COLOR[s.material]));
      this.stones.push({ def: s, entity, mesh, batch: b, slot, mode: 'tray', home: homes[i], pose: { ...homes[i] } });
    });
    for (const b of this.batches) if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    this.hook.state = 'ready';
  }

  private clear(): void {
    this.hideGhost('left');
    this.hideGhost('right');
    for (const e of this.levelEntities) e.dispose();
    this.levelEntities = [];
    for (const child of [...this.site.children]) if (!(child instanceof DirectionalLight)) this.site.remove(child);
    this.stones = [];
    this.batches = [];
    this.thrustLine = undefined;
  }

  /** Track an extra entity that belongs to this level (physics colliders and the like). */
  own(e: Entity): Entity {
    this.levelEntities.push(e);
    return e;
  }

  stoneById(id: string): StoneView | undefined {
    return this.stones.find(v => v.def.id === id);
  }

  /** Open faces this stone may join now, with the pose it would take there. */
  targets(v: StoneView): { side: Side; pose: Pose2 }[] {
    if (this.state.phase !== 'building') return [];
    const out: { side: Side; pose: Pose2 }[] = [];
    for (const side of ['left', 'right'] as const) {
      if (!whyNot(this.state, v.def, side)) out.push({ side, pose: facePose(this.state, v.def, side) });
    }
    return out;
  }

  /** Seat a stone on a face. Returns the refusal reason, or undefined when it snapped. */
  place(v: StoneView, side: Side, duration = 0.12, lift = 0): string | undefined {
    const pose = this.state.phase === 'building' && !whyNot(this.state, v.def, side) ? facePose(this.state, v.def, side) : undefined;
    const next = placeStone(this.state, v.def.id, side);
    if (next.error || !pose) {
      playReject();
      this.sendHome(v);
      return next.error ?? 'no face';
    }
    this.state = next;
    v.heldBy = undefined;
    this.tweenTo(v, pose, duration, lift, 'placed');
    playTick();
    if (this.hook.state === 'ready') this.hook.state = 'building';
    return undefined;
  }

  /** Lift the outermost stone of `side` back off the arch (it becomes held or returns to the tray). */
  unplace(v: StoneView): boolean {
    const p = this.state.placed.find(q => q.stone.id === v.def.id);
    if (!p) return false;
    const next = takeBack(this.state, p.side);
    if (next.error || next.tray.every(t => t.id !== v.def.id)) return false;
    this.state = next;
    return true;
  }

  sendHome(v: StoneView, duration = 0.45): void {
    v.heldBy = undefined;
    this.tweenTo(v, v.home, duration, 0.04, 'tray');
  }

  tweenTo(v: StoneView, to: Pose2, dur: number, lift: number, then: StoneMode): void {
    v.tween = { from: { ...v.pose }, to: { ...to }, t: 0, dur, lift, then };
    v.mode = 'tween';
  }

  /** Show where `v` would seat (a see-through copy at `pose`); `near` in [0, 1] firms it up. */
  showGhost(side: Side, v: StoneView, pose: Pose2, near: number): void {
    const g = this.ghosts[side];
    const mat = g.material as MeshBasicMaterial;
    g.geometry = this.batches[v.batch].mesh.geometry;
    ghostColor(v.def.material, mat.color);
    mat.opacity = 0.25 + 0.25 * near;
    this.applyPose(g, pose);
    g.visible = true;
  }

  hideGhost(side: Side): void {
    this.ghosts[side].visible = false;
  }

  /** Write a site-frame pose into an object's world transform (stones are top-level entities). */
  applyPose(obj: Object3D, p: Pose2): void {
    tmpV.set(p.x, p.y, p.z);
    this.site.localToWorld(tmpV);
    obj.position.copy(tmpV);
    this.site.getWorldQuaternion(obj.quaternion);
    obj.quaternion.multiply(tmpQ.setFromAxisAngle(xAxis, p.tilt)).multiply(tmpQ2.setFromAxisAngle(zAxis, p.angle));
  }

  /** World position of a site-frame point. */
  siteToWorld(p: Pose2, out: Vector3): Vector3 {
    return this.site.localToWorld(out.set(p.x, p.y, p.z));
  }

  get boardDepth(): number { return BOARD.zMax - BOARD.zMin; }
}

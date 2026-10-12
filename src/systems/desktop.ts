// Desktop mouse (and touch) mode, for play-testers without a headset: active whenever no XR session
// is running. Click a stone and it rises off the tray, with a see-through ghost at each open face it
// may join; click a ghost and the stone seats there. Clicking the stone again, or the bare board,
// puts it back; clicking the outermost stone of either half lifts it off the arch again. Drag the
// centering's handle down the page (DRAG_PX) to pull it out and strike the arch. After a collapse
// the rebuild stone and the level markers beside the board take a click as they take a pinch.
//
// Picking goes through IWSDK's canvas pointer path: the page's pointer events are forwarded into
// the scene, onto entities tagged RayInteractable (iwsdk.config.json, input.canvasPointerEvents).
// The tags come off while an XR session runs, so hands and controllers never meet these targets.
import {
  BoxGeometry, createSystem, Mesh, MeshBasicMaterial, Object3D, RayInteractable, SphereGeometry, Vector3,
  type BufferGeometry, type Entity,
} from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import { BOARD, CENTERING, strikePull, type Pose2 } from '../scene/layout.js';
import { leverPull, ndcToCss } from '../game/desktop.js';
import type { LoopPicker } from './loop.js';

export const LIFT = 0.045;      // m a picked stone rises above its tray spot
const LIFT_TIME = 0.22;
const SEAT_TIME = 0.32;
const SIDES = ['left', 'right'] as const;

type Listener = (e: { point: Vector3 }) => void;
const on = (o: Object3D, type: string, fn: Listener) => o.addEventListener(type as never, fn as never);

export class DesktopSystem extends createSystem({}) {
  private active = false;
  private generation = -1;
  private selected: StoneView | undefined;
  private lifted: Pose2 = { x: 0, y: 0, z: 0, angle: 0, tilt: 0 };
  private faces!: Record<Side, Mesh>;
  private facePose: Record<Side, Pose2 | undefined> = { left: undefined, right: undefined };
  private lever!: Mesh;
  private board!: Mesh;
  private rebuild!: Mesh;
  private proxies: Entity[] = [];
  private hovered = new Set<Object3D>();
  private downY = 0;
  private drag: { y0: number; pull0: number; dy: number } | undefined;
  private t = 0;
  private v = new Vector3();
  private scratch = new Object3D();
  private canvas!: HTMLCanvasElement;

  init(): void {
    const hidden = new MeshBasicMaterial({ visible: false }); // hit shapes only: never drawn
    const proxy = (mesh: Mesh, name: string) => {
      mesh.name = name;
      mesh.visible = false;
      this.proxies.push(this.world.createTransformEntity(mesh, { persistent: true }));
      return mesh;
    };
    this.faces = {
      left: proxy(new Mesh(new BoxGeometry(0.01, 0.01, 0.01), hidden), 'face-left'),
      right: proxy(new Mesh(new BoxGeometry(0.01, 0.01, 0.01), hidden), 'face-right'),
    };
    this.lever = proxy(new Mesh(new BoxGeometry(0.1, 0.045, CENTERING.handleDepth + 0.03), hidden), 'lever-hit');
    // Board plus the marker columns beside it: a click here is a marker pick or "put the stone back".
    this.board = proxy(new Mesh(new BoxGeometry(BOARD.width + 0.16, 0.004, BOARD.zMax - BOARD.zMin + 0.06), hidden), 'board-hit');
    this.rebuild = proxy(new Mesh(new SphereGeometry(0.028, 12, 8), hidden), 'rebuild-hit');

    for (const side of SIDES) {
      on(this.faces[side], 'pointerdown', () => this.seat(side));
      this.hover(this.faces[side]);
    }
    on(this.lever, 'pointerdown', () => this.grab());
    this.hover(this.lever);
    on(this.board, 'pointerdown', e => this.onBoard(e.point));
    on(this.rebuild, 'pointerdown', () => {
      const loop = this.globals.loop as LoopPicker | undefined;
      const at = loop?.rebuildAt(this.v);
      if (at) loop!.pick(at);
    });
    this.hover(this.rebuild);

    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none'; // a touch drag works the lever instead of scrolling the page
    // Capture phase, so the press position is known before the scene gets the same event.
    const down = (e: PointerEvent) => { this.downY = e.clientY; };
    const move = (e: PointerEvent) => { if (this.drag) this.drag.dy = e.clientY - this.drag.y0; };
    const up = () => { this.drag = undefined; this.cursor(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    });

    const arch = this.globals.arch as ArchRuntime | undefined;
    if (arch) {
      arch.hook.project = target => this.project(target);
      Object.defineProperty(arch.hook, 'placed', { get: () => arch.state?.placed.length ?? 0, enumerable: true });
      Object.defineProperty(arch.hook, 'debug', { get: () => ({ solution: arch.def?.solution ?? [] }), enumerable: true });
    }
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    this.t += delta;
    const active = !this.renderer.xr.isPresenting;
    if (active !== this.active || arch.generation !== this.generation) {
      this.active = active;
      this.generation = arch.generation;
      this.selected = undefined;
      this.drag = undefined;
      this.hovered.clear();
      this.cursor();
      this.tag(arch);
      this.refreshFaces(arch);
    }
    if (!active) return;

    const building = this.canBuild(arch);
    if (this.selected && (!building || (this.selected.mode !== 'held' && this.selected.mode !== 'tween'))) {
      this.drop(arch); // the arch was struck, or something else took the stone
    }
    const s = this.selected;
    if (s?.mode === 'held') s.pose.y = this.lifted.y + 0.003 * Math.sin(this.t * 3);

    // Hit shapes follow the board (it may have moved) and what is on it.
    const c = arch.centering;
    const lever = arch.shown && arch.state.placed.length > 0 && !c.struck;
    this.lever.visible = lever;
    if (lever) this.follow(this.lever, c.handle.getWorldPosition(this.v));
    if (this.drag && lever) c.pull = leverPull(this.drag.dy, this.drag.pull0, strikePull(arch.def.depth), CENTERING.maxPull);
    else if (this.drag) this.drag = undefined;

    this.board.visible = arch.shown;
    this.follow(this.board, arch.site.localToWorld(this.v.set(0, 0.002, (BOARD.zMin + BOARD.zMax) / 2)));
    const at = (this.globals.loop as LoopPicker | undefined)?.rebuildAt(this.v);
    this.rebuild.visible = !!at;
    if (at) this.follow(this.rebuild, at);
  }

  private canBuild(arch: ArchRuntime): boolean {
    return arch.shown && (arch.state.phase === 'building' || arch.state.phase === 'ready');
  }

  /** RayInteractable on the stones and hit shapes outside XR only. */
  private tag(arch: ArchRuntime): void {
    for (const v of arch.stones) {
      const has = v.entity.hasComponent(RayInteractable);
      if (this.active && !has) {
        v.entity.addComponent(RayInteractable);
        if (!v.mesh.userData.desktop) {
          v.mesh.userData.desktop = true;
          on(v.mesh, 'pointerdown', () => this.pick(arch, v));
          this.hover(v.mesh);
        }
      } else if (!this.active && has) v.entity.removeComponent(RayInteractable);
    }
    for (const e of this.proxies) {
      if (this.active) { if (!e.hasComponent(RayInteractable)) e.addComponent(RayInteractable); }
      else if (e.hasComponent(RayInteractable)) e.removeComponent(RayInteractable);
    }
    if (!this.active) for (const m of [this.lever, this.board, this.rebuild]) m.visible = false;
  }

  private pick(arch: ArchRuntime, v: StoneView): void {
    if (!this.active || !this.canBuild(arch)) return;
    if (this.selected === v) { this.drop(arch); return; }
    const free = v.mode === 'tray' || (v.mode === 'tween' && v.tween?.then === 'tray');
    if (!free) {
      // The outermost stone of either half comes back off the arch, as a pinch would take it.
      if (v.mode !== 'placed' || !this.outermost(arch, v) || !arch.unplace(v)) return;
    }
    if (this.selected) arch.sendHome(this.selected);
    this.selected = v;
    v.heldBy = undefined;
    Object.assign(this.lifted, v.home);
    this.lifted.y += LIFT;
    arch.tweenTo(v, this.lifted, LIFT_TIME, 0.01, 'held');
    this.refreshFaces(arch);
  }

  private outermost(arch: ArchRuntime, v: StoneView): boolean {
    const placed = arch.state.placed;
    return SIDES.some(side => {
      for (let i = placed.length - 1; i >= 0; i--) if (placed[i].side === side) return placed[i].stone.id === v.def.id;
      return false;
    });
  }

  private seat(side: Side): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const v = this.selected;
    if (!arch || !v || !this.active || !this.canBuild(arch) || !this.facePose[side]) return;
    this.selected = undefined;
    arch.place(v, side, SEAT_TIME, 0.03);
    this.refreshFaces(arch);
  }

  private drop(arch: ArchRuntime): void {
    const v = this.selected;
    this.selected = undefined;
    if (v && (v.mode === 'held' || v.mode === 'tween')) arch.sendHome(v);
    this.refreshFaces(arch);
  }

  private onBoard(point: Vector3): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch || !this.active) return;
    if ((this.globals.loop as LoopPicker | undefined)?.pick(point)) return;
    if (this.selected) this.drop(arch);
  }

  private grab(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch || !this.active || !this.lever.visible) return;
    if (this.selected) this.drop(arch);
    this.drag = { y0: this.downY, pull0: arch.centering.pull, dy: 0 };
    this.cursor();
  }

  /** Ghost and hit shape at each open face the selected stone may join; none without a selection. */
  private refreshFaces(arch: ArchRuntime): void {
    const v = this.active ? this.selected : undefined;
    const targets = v ? arch.targets(v) : [];
    for (const side of SIDES) {
      const t = targets.find(q => q.side === side);
      const face = this.faces[side];
      this.facePose[side] = t?.pose;
      if (!v || !t) {
        face.visible = false;
        arch.hideGhost(side);
        continue;
      }
      face.geometry = arch.batches[v.batch].mesh.geometry;
      arch.applyPose(face, t.pose);
      face.updateMatrixWorld();
      face.visible = true;
      arch.showGhost(side, v, t.pose, this.hovered.has(face) ? 1 : 0.4);
    }
  }

  private follow(m: Mesh, at: Vector3): void {
    const arch = this.globals.arch as ArchRuntime;
    m.position.copy(at);
    arch.site.getWorldQuaternion(m.quaternion);
    m.updateMatrixWorld();
  }

  private hover(o: Object3D): void {
    on(o, 'pointerenter', () => { this.hovered.add(o); this.onHover(o); });
    on(o, 'pointerleave', () => { this.hovered.delete(o); this.onHover(o); });
  }

  private onHover(o: Object3D): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (arch && (o === this.faces.left || o === this.faces.right)) this.refreshFaces(arch);
    this.cursor();
  }

  private cursor(): void {
    if (!this.canvas) return;
    this.canvas.style.cursor = this.drag ? 'grabbing' : this.hovered.has(this.lever) ? 'grab' : this.hovered.size ? 'pointer' : '';
  }

  /** Centre of a target on the page (CSS px), or null when there is no such target now. */
  private project(target: string): { x: number; y: number } | null {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return null;
    if (target === 'lever') {
      if (!arch.centering) return null;
      arch.centering.handle.getWorldPosition(this.v);
    } else if (target === 'face:left' || target === 'face:right') {
      const side: Side = target === 'face:left' ? 'left' : 'right';
      // The selected stone's face; without one, where the first tray stone that fits would go.
      const pool = this.selected ? [this.selected] : arch.stones.filter(s => s.mode === 'tray');
      let hit: { v: StoneView; pose: Pose2 } | undefined;
      for (const s of pool) {
        const t = arch.targets(s).find(q => q.side === side);
        if (t) { hit = { v: s, pose: t.pose }; break; }
      }
      if (!hit) return null;
      this.centre(arch, arch.batches[hit.v.batch].mesh.geometry, hit.pose);
    } else {
      const s = arch.stoneById(target);
      if (!s) return null;
      this.centre(arch, arch.batches[s.batch].mesh.geometry, s.pose);
    }
    this.camera.updateMatrixWorld();
    this.v.project(this.camera);
    return ndcToCss(this.v.x, this.v.y, this.v.z, this.canvas.getBoundingClientRect());
  }

  /**
   * World-space point to click on a stone shape at `pose`, into this.v: its centre, or for a stone
   * lying in the tray the middle of its upper face. Tray stones stand as tall as the arch is deep, so
   * from 35° above the centre of a back-row stone is hidden behind the row in front of it.
   */
  private centre(arch: ArchRuntime, geo: BufferGeometry, pose: Pose2): void {
    if (!geo.boundingBox) geo.computeBoundingBox();
    geo.boundingBox!.getCenter(this.v);
    if (pose.tilt !== 0) this.v.z = geo.boundingBox!.max.z - 0.002; // prism depth runs along z; lying, +z is up
    arch.applyPose(this.scratch, pose);
    this.scratch.updateMatrixWorld();
    this.v.applyMatrix4(this.scratch.matrixWorld);
  }
}

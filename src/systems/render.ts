// Visual sync: stone poses -> proxy transforms -> one instanced draw per stone shape, the pinch
// cursors, and the performance numbers for window.__archwright. The hover stone (the one a pinch
// would take) is drawn HOVER_LIFT higher; in high contrast it also gets an outline, a slightly
// larger back-face copy in the pinch colour (one draw call, only while there is a hover stone).
import { BackSide, createSystem, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { HOVER_LIFT, type ArchRuntime } from '../game/runtime.js';
import { FrameStats } from '../game/frame-stats.js';
import { paint } from '../scene/palette.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';

const OUTLINE_GROW = 1.12;

export class StoneRenderSystem extends createSystem({}) {
  private m = new Matrix4();
  private cursors: Record<Side, Mesh> | undefined;
  private idle = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false });
  private active = new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false });
  private outline!: Mesh;
  private c = new Vector3();
  private grow = new Matrix4();

  init(): void {
    paint(this.active.color, 'pinch');
    const line = new MeshBasicMaterial({ side: BackSide });
    paint(line.color, 'pinch');
    this.outline = new Mesh(undefined, line);
    this.outline.name = 'hover-outline';
    this.outline.visible = false;
    this.world.createTransformEntity(this.outline, { persistent: true });
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
    this.outline.visible = false;
    if (!arch?.stones.length) return;
    for (const v of arch.stones) {
      if (v.mode !== 'dynamic') arch.applyPose(v.mesh, v.pose);
      v.mesh.updateMatrix();
      v.mesh.updateMatrixWorld();
      const b = arch.batches[v.batch].mesh;
      this.m.copy(v.mesh.matrixWorld);
      if (v === arch.hover) {
        this.m.elements[13] += HOVER_LIFT; // world up: the board is level
        if (arch.hook.a11y?.highContrast && b.visible) this.outlineAt(b, this.m);
      }
      b.setMatrixAt(v.slot, this.m);
    }
    for (const b of arch.batches) b.mesh.instanceMatrix.needsUpdate = true;
  }

  /** The outline over a stone of `batch` drawn at `m`: the same shape, OUTLINE_GROW larger about its middle. */
  private outlineAt(batch: Mesh, m: Matrix4): void {
    const geo = batch.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    geo.boundingBox!.getCenter(this.c);
    const k = OUTLINE_GROW;
    this.grow.makeScale(k, k, k).setPosition(this.c.x * (1 - k), this.c.y * (1 - k), this.c.z * (1 - k));
    this.outline.geometry = geo;
    this.grow.premultiply(m).decompose(this.outline.position, this.outline.quaternion, this.outline.scale);
    this.outline.visible = true;
  }
}

/** Runs first each frame: marks the start of the JS frame. */
export class PerfStartSystem extends createSystem({}) {
  update(): void {
    this.globals.frameStart = performance.now();
  }
}

const ARM_AFTER = 3;
const STATS_EVERY = 0.25; // s: the frame-time percentiles are sorted out this often, not every frame

/** Runs last each frame: frame rate, JS time per frame, the last rendered frame's counts, and the median and slow-frame
 *  rates of the last frames (globals.frameStats for the ?debug overlay, p50 and p5 in __archwright.perf). */
export class PerfEndSystem extends createSystem({}) {
  private fps = 0;
  private ms = 0;
  private frames = 0;
  private times = new FrameStats();
  private since = 0;

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch) return;
    // Pointer targets are collected one frame and hit-tested the next; the canvas has its size by then.
    if (++this.frames === ARM_AFTER) arch.arm();
    const js = performance.now() - (this.globals.frameStart as number ?? performance.now());
    const k = 0.1;
    if (delta > 0) this.fps = this.fps ? this.fps + (1 / delta - this.fps) * k : 1 / delta;
    this.ms = this.ms ? this.ms + (js - this.ms) * k : js;
    this.times.push(delta);
    const p = arch.hook.perf;
    this.since += delta;
    if (this.since >= STATS_EVERY) {
      this.since = 0;
      const t = this.times.stats();
      this.globals.frameStats = t;
      p.p50 = Math.round(t.p50 * 10) / 10;
      p.p5 = Math.round(t.p5 * 10) / 10;
    }
    p.fps = Math.round(this.fps * 10) / 10;
    p.frameMs = Math.round(this.ms * 100) / 100;
    p.drawCalls = this.renderer.info.render.calls;
    p.triangles = this.renderer.info.render.triangles;
    p.bodies = arch.bodies;
  }
}

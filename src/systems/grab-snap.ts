// Pinch a stone, carry it, release it near an open face: it snaps on with a tock. Proximity-gated
// (the pinch must start on a stone), no rotation (the stone orients itself), no throwing (release
// velocity is ignored), and a stone whose hand loses tracking floats back to the tray.
import { createSystem, Vector3 } from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import { LOST_AFTER } from './hands.js';
import type { Pose2 } from '../scene/layout.js';

export const GRAB_RADIUS = 0.05;   // pinch must start this close to a stone's centre (m)
export const SNAP_RADIUS = 0.06;   // release this close to a face pose and the stone seats
export const MAGNET_RADIUS = 0.1;  // within this the held stone eases towards the face pose

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};

export class GrabSnapSystem extends createSystem({}) {
  private held: Record<Side, StoneView | undefined> = { left: undefined, right: undefined };
  private local = new Vector3();
  private p = new Vector3();

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    if (!arch?.state || !hands) return;

    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      const v = this.held[side];
      if (v && (v.mode !== 'held' || v.heldBy !== side)) { this.held[side] = undefined; continue; }
      if (!v && h.pinchStarted && h.tracked) this.tryGrab(arch, side, h);
      else if (v && (h.pinchEnded || (!h.tracked && h.lostFor > LOST_AFTER))) this.release(arch, side, v, h.tracked && h.pinchEnded);
      else if (v && h.tracked) this.carry(arch, v, h, delta);
    }
    for (const v of arch.stones) if (v.mode === 'tween' && v.tween) this.step(v, delta);
  }

  private tryGrab(arch: ArchRuntime, side: Side, h: HandState): void {
    if (arch.state.phase !== 'building' && arch.state.phase !== 'ready') return;
    arch.site.worldToLocal(this.local.copy(h.point));
    let best: StoneView | undefined;
    let bestD = GRAB_RADIUS;
    // Tray stones, plus the outermost stone of each half (pinching it lifts it back off).
    const outer = new Set<string>();
    for (const s of ['left', 'right'] as const) {
      const last = [...arch.state.placed].reverse().find(p => p.side === s);
      if (last) outer.add(last.stone.id);
    }
    for (const v of arch.stones) {
      const free = v.mode === 'tray' || (v.mode === 'tween' && v.tween?.then === 'tray');
      if (!free && !(v.mode === 'placed' && outer.has(v.def.id))) continue;
      const d = this.p.set(v.pose.x, v.pose.y, v.pose.z).distanceTo(this.local);
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return;
    if (best.mode === 'placed' && !arch.unplace(best)) return;
    best.mode = 'held';
    best.tween = undefined;
    best.heldBy = side;
    this.held[side] = best;
  }

  private carry(arch: ArchRuntime, v: StoneView, h: HandState, delta: number): void {
    arch.site.worldToLocal(this.local.copy(h.point));
    // Ease towards the nearest face pose when close: magnetic snap preview; otherwise stand upright.
    let target: Pose2 | undefined;
    let dist = MAGNET_RADIUS;
    for (const t of arch.targets(v)) {
      const d = this.p.set(t.pose.x, t.pose.y, t.pose.z).distanceTo(this.local);
      if (d < dist) { dist = d; target = t.pose; }
    }
    const k = Math.min(1, delta * 18);
    if (target) {
      const pull = 1 - dist / MAGNET_RADIUS; // 0 at the edge, 1 on the pose
      const m = pull * pull;
      v.pose.x += (this.local.x + (target.x - this.local.x) * m - v.pose.x) * k;
      v.pose.y += (this.local.y + (target.y - this.local.y) * m - v.pose.y) * k;
      v.pose.z += (this.local.z + (target.z - this.local.z) * m - v.pose.z) * k;
      v.pose.angle = lerpAngle(v.pose.angle, target.angle, Math.min(1, delta * 12));
      v.pose.tilt = lerpAngle(v.pose.tilt, target.tilt, Math.min(1, delta * 12));
    } else {
      v.pose.x += (this.local.x - v.pose.x) * k;
      v.pose.y += (this.local.y - v.pose.y) * k;
      v.pose.z += (this.local.z - v.pose.z) * k;
      v.pose.angle = lerpAngle(v.pose.angle, 0, Math.min(1, delta * 8));
      v.pose.tilt = lerpAngle(v.pose.tilt, 0, Math.min(1, delta * 8));
    }
  }

  private release(arch: ArchRuntime, side: Side, v: StoneView, deliberate: boolean): void {
    this.held[side] = undefined;
    if (deliberate) {
      let best: Side | undefined;
      let bestD = SNAP_RADIUS;
      for (const t of arch.targets(v)) {
        const d = this.p.set(t.pose.x, t.pose.y, t.pose.z).distanceTo(this.local.set(v.pose.x, v.pose.y, v.pose.z));
        if (d < bestD) { bestD = d; best = t.side; }
      }
      if (best) { arch.place(v, best); return; }
    }
    arch.sendHome(v, deliberate ? 0.45 : 0.7);
  }

  private step(v: StoneView, delta: number): void {
    const tw = v.tween!;
    tw.t = Math.min(1, tw.t + delta / tw.dur);
    const e = ease(tw.t);
    v.pose.x = tw.from.x + (tw.to.x - tw.from.x) * e;
    v.pose.y = tw.from.y + (tw.to.y - tw.from.y) * e + tw.lift * Math.sin(Math.PI * tw.t);
    v.pose.z = tw.from.z + (tw.to.z - tw.from.z) * e;
    v.pose.angle = lerpAngle(tw.from.angle, tw.to.angle, e);
    v.pose.tilt = lerpAngle(tw.from.tilt, tw.to.tilt, e);
    if (tw.t >= 1) { v.mode = tw.then; v.tween = undefined; }
  }
}

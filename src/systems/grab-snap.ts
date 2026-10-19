// Pinch a stone (a short knock, music.grabCue), carry it, release it near an open face: it snaps on with a tock. Proximity-gated
// (the pinch must start on a stone), no rotation (the stone orients itself), no throwing (release
// velocity is ignored), and a stone whose hand loses tracking floats back to the tray. While a
// stone is carried near an open face, a see-through ghost shows where it would seat. Before the
// pinch, the stone it would take is marked: pickTarget, the same choice the grab makes, lifts it
// 4 mm and lightens it (runtime.setHover); not for a hand with its palm up, whose pinch takes nothing. The desktop mode
// marks the stone under the mouse. In gaze mode a pinch confirms the target looked at, so while there is one the mark
// follows the eyes instead (hoverStone).
import { createSystem, Vector3 } from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import { LOST_AFTER } from './hands.js';
import type { Pose2 } from '../scene/layout.js';
import { playCue } from '../audio/synth.js';
import { grabCue } from '../audio/music.js';

export const GRAB_RADIUS = 0.05;   // pinch must start this close to a stone's centre (m)
export const SNAP_RADIUS = 0.06;   // release this close to a face pose and the stone seats
export const MAGNET_RADIUS = 0.1;  // within this the held stone eases towards the face pose
export const GHOST_RADIUS = 0.16;  // within this the face shows a ghost of the held stone
export const PICK_TIE = 0.0005;    // centres this close in distance count as equally near (m)

export interface PickCandidate { id: string; x: number; y: number; z: number }

/**
 * The stone a pinch at `point` takes: the candidate whose centre is nearest, if nearer than `radius`;
 * of centres within PICK_TIE of the nearest, the one listed first. Null when none is in reach.
 */
export function pickTarget(point: { x: number; y: number; z: number }, candidates: readonly PickCandidate[], radius = GRAB_RADIUS): string | null {
  const d = (c: PickCandidate) => Math.hypot(c.x - point.x, c.y - point.y, c.z - point.z);
  let best = radius;
  for (const c of candidates) best = Math.min(best, d(c));
  for (const c of candidates) if (d(c) < radius && d(c) <= best + PICK_TIE) return c.id;
  return null;
}

/** What gaze mode looks at this frame: nothing (`on` false), or a target, which is `stone` if it is a stone. */
export interface GazeLook<T> { on: boolean; stone: T | undefined }

/**
 * The stone to mark before a pinch. While gaze mode looks at a target, the pinch confirms that target: the stone
 * looked at, or none if the target is not a stone. Otherwise the stone the hands' pinch would take.
 */
export function hoverStone<T>(gaze: GazeLook<T>, hand: T | undefined): T | undefined {
  return gaze.on ? gaze.stone : hand;
}

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
  private generation = -1;
  private candidates: PickCandidate[] = [];
  private pool: PickCandidate[] = [];

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    if (!arch?.state || !hands) return;
    // A new level (next, rebuild, a marker, autotest): stones held from the old one are gone.
    if (arch.generation !== this.generation) { this.generation = arch.generation; this.held = { left: undefined, right: undefined }; }

    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      const v = this.held[side];
      if (v && (v.mode !== 'held' || v.heldBy !== side)) { this.held[side] = undefined; arch.hideGhost(side); continue; }
      if (!v && h.pinchStarted && h.tracked) this.tryGrab(arch, side, h);
      else if (v && (h.pinchEnded || (!h.tracked && h.lostFor > LOST_AFTER))) this.release(arch, side, v, h.tracked && h.pinchEnded);
      else if (v && h.tracked) this.carry(arch, side, v, h, delta);
      if (v && !this.held[side]) arch.hideGhost(side); // let go: the stone seated or went home
    }
    for (const v of arch.stones) if (v.mode === 'tween' && v.tween) this.step(v, delta);
    if (this.renderer.xr.isPresenting) arch.setHover(hoverStone(arch.gaze, this.hover(arch, hands))); // outside XR the desktop mode marks
  }

  /** The stone a pinch would take now, of the hands that are tracked and hold nothing: the nearer one's. A hand with its
   *  palm up is left out: its pinch is the system gesture and starts no game pinch (src/systems/hands.ts). */
  private hover(arch: ArchRuntime, hands: Record<Side, HandState>): StoneView | undefined {
    let best: StoneView | undefined;
    let bestD = Infinity;
    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      arch.handStone[side] = undefined;
      if (this.held[side] || !h.tracked || h.pinching || h.palmUp) continue;
      const v = (arch.handStone[side] = this.pick(arch, h));
      if (!v) continue;
      const d = this.p.set(v.pose.x, v.pose.y, v.pose.z).distanceTo(this.local);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  /** pickTarget at this hand's pinch point (left in this.local, site frame), among the stones a pinch may take. */
  private pick(arch: ArchRuntime, h: HandState): StoneView | undefined {
    if (!arch.shown || (arch.state.phase !== 'building' && arch.state.phase !== 'ready')) return undefined;
    arch.site.worldToLocal(this.local.copy(h.point));
    const id = pickTarget(this.local, this.fill(arch));
    return id === null ? undefined : arch.stoneById(id);
  }

  /** Tray stones, plus the outermost stone of each half (pinching it lifts it back off); reused objects. */
  private fill(arch: ArchRuntime): PickCandidate[] {
    const placed = arch.state.placed;
    let left: string | undefined, right: string | undefined;
    for (let i = placed.length - 1; i >= 0 && !(left && right); i--) {
      if (placed[i].side === 'left') left ??= placed[i].stone.id;
      else right ??= placed[i].stone.id;
    }
    const out = this.candidates;
    let n = 0;
    for (const v of arch.stones) {
      const free = v.mode === 'tray' || (v.mode === 'tween' && v.tween?.then === 'tray');
      if (!free && !(v.mode === 'placed' && (v.def.id === left || v.def.id === right))) continue;
      const c = (this.pool[n] ??= { id: '', x: 0, y: 0, z: 0 });
      c.id = v.def.id; c.x = v.pose.x; c.y = v.pose.y; c.z = v.pose.z;
      out[n++] = c;
    }
    out.length = n;
    return out;
  }

  private tryGrab(arch: ArchRuntime, side: Side, h: HandState): void {
    const best = this.pick(arch, h);
    if (!best) return;
    if (best.mode === 'placed' && !arch.unplace(best)) return;
    best.mode = 'held';
    best.tween = undefined;
    best.heldBy = side;
    this.held[side] = best;
    playCue(grabCue(best.def.material));
  }

  private carry(arch: ArchRuntime, side: Side, v: StoneView, h: HandState, delta: number): void {
    arch.site.worldToLocal(this.local.copy(h.point));
    // Nearest open face: a ghost from GHOST_RADIUS, and inside MAGNET_RADIUS the stone eases onto
    // it (magnetic snap preview); otherwise the stone stands upright in the hand.
    let nearest: Pose2 | undefined;
    let dist = GHOST_RADIUS;
    for (const t of arch.targets(v)) {
      const d = this.p.set(t.pose.x, t.pose.y, t.pose.z).distanceTo(this.local);
      if (d < dist) { dist = d; nearest = t.pose; }
    }
    if (nearest) arch.showGhost(side, v, nearest, 1 - dist / GHOST_RADIUS);
    else arch.hideGhost(side);
    const target = dist < MAGNET_RADIUS ? nearest : undefined;
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

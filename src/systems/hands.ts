// One pinch point per hand, from WebXR hand joints (thumb tip + index tip), with two-threshold
// hysteresis. A controller stands in for a hand (trigger or squeeze = pinch) so the emulator and
// controller users can play too, but nothing requires one.
import { createSystem, InputComponent, Matrix4, Vector3 } from '@iwsdk/core';
import type { Side } from '../game/arch-state.js';
import { isPalmUp } from '../game/palm.js';
import type { ArchRuntime, Hook } from '../game/runtime.js';

export const PINCH_ON = 0.02;    // thumb-index tip distance that starts a pinch (m)
export const PINCH_OFF = 0.035;  // ... and that ends it
// s without tracking before a pinch ends and a held stone goes back to the tray: long enough that a hand passing behind
// the other for a moment keeps its stone.
export const LOST_AFTER = 0.3;

export interface HandState {
  tracked: boolean;
  pinching: boolean;
  pinchStarted: boolean;   // this frame
  pinchEnded: boolean;     // this frame
  point: Vector3;          // world-space pinch point (last known when not tracked)
  lostFor: number;         // seconds since tracking was last seen
  palmUp: boolean;
}

const newHand = (): HandState => ({
  tracked: false, pinching: false, pinchStarted: false, pinchEnded: false, point: new Vector3(), lostFor: 0, palmUp: false,
});

export class HandSystem extends createSystem({}) {
  readonly hands: Record<Side, HandState> = { left: newHand(), right: newHand() };
  private origin = new Matrix4();
  private a = new Vector3();
  private b = new Vector3();
  private w = new Vector3();
  private im = new Vector3();
  private pm = new Vector3();
  private view: Hook['hands'] | undefined;

  init(): void {
    this.globals.hands = this.hands;
    this.view = (this.globals.arch as ArchRuntime | undefined)?.hook.hands;
  }

  update(delta: number): void {
    const frame = this.xrFrame;
    const ref = this.renderer.xr.getReferenceSpace();
    this.origin.copy(this.player.matrixWorld);
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side];
      h.pinchStarted = h.pinchEnded = false;
      let seen = false;
      let pinch = h.pinching;
      const src = frame && ref ? this.input.xr.getPrimaryInputSource(side) : undefined;
      if (src?.hand && frame && ref) {
        const thumb = src.hand.get('thumb-tip'), index = src.hand.get('index-finger-tip');
        const tp = thumb && frame.getJointPose?.(thumb, ref);
        const ip = index && frame.getJointPose?.(index, ref);
        if (tp && ip) {
          seen = true;
          this.toWorld(tp.transform.position, this.a);
          this.toWorld(ip.transform.position, this.b);
          const d = this.a.distanceTo(this.b);
          h.point.copy(this.a).add(this.b).multiplyScalar(0.5);
          pinch = h.pinching ? d < PINCH_OFF : d < PINCH_ON;
          h.palmUp = this.palmUp(src.hand, frame, ref, side);
        }
      } else if (src?.gamepad) {
        const pad = this.input.xr.gamepads[side];
        const grip = this.player.gripSpaces[side];
        if (pad && grip) {
          seen = true;
          grip.getWorldPosition(h.point);
          const v = Math.max(pad.getButtonValue(InputComponent.Trigger) ?? 0, pad.getButtonValue(InputComponent.Squeeze) ?? 0);
          pinch = h.pinching ? v > 0.3 : v > 0.6;
          h.palmUp = false;
        }
      }
      if (seen) {
        h.tracked = true;
        h.lostFor = 0;
        // The palm-up pinch is Quest's system gesture: never start a game pinch with it.
        if (pinch && !h.pinching && h.palmUp) pinch = false;
        if (pinch !== h.pinching) { h.pinchStarted = pinch; h.pinchEnded = !pinch; h.pinching = pinch; }
      } else {
        h.tracked = false;
        h.lostFor += delta;
        if (h.pinching && h.lostFor > LOST_AFTER) { h.pinching = false; h.pinchEnded = true; }
      }
      const v = this.view?.[side];
      if (v) { v.tracked = h.tracked; v.pinching = h.pinching; v.palmUp = h.palmUp; }
    }
  }

  private toWorld(p: DOMPointReadOnly, out: Vector3): Vector3 {
    return out.set(p.x, p.y, p.z).applyMatrix4(this.origin);
  }

  // Palm up (src/game/palm.ts) from the wrist and the index / pinky metacarpals in the world: the system gesture's pose.
  private palmUp(hand: XRHand, frame: XRFrame, ref: XRReferenceSpace, side: Side): boolean {
    const wj = hand.get('wrist'), ij = hand.get('index-finger-metacarpal'), pj = hand.get('pinky-finger-metacarpal');
    const wp = wj && frame.getJointPose?.(wj, ref), ip = ij && frame.getJointPose?.(ij, ref), pp = pj && frame.getJointPose?.(pj, ref);
    if (!wp || !ip || !pp) return false;
    this.toWorld(wp.transform.position, this.w);
    this.toWorld(ip.transform.position, this.im);
    this.toWorld(pp.transform.position, this.pm);
    return isPalmUp(this.w, this.im, this.pm, side);
  }
}

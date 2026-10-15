// ?emulator=1&handplay=solution|trap: an emulated hand plays the level on the board, for the emulator test and
// the video only. The page moves IWER's right hand and turns its pinch value up and down, and does nothing else:
// the game reads that hand from its WebXR joints like any hand (thumb and index tips, src/systems/hands.ts),
// picks up and seats the stones through src/systems/grab-snap.ts and pulls the centering through
// src/systems/centering.ts. Where the stones, the open faces and the handle are is read from the runtime, as a
// player would see them. Compare ?autotest, which places the stones by program and never uses a hand.
// Loaded on demand (src/index.ts), so it is not in the first load. Movement and pinch are capped per frame, so a
// slow software-rendered frame never jumps past a grab or a snap.
import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import type { XRDevice } from 'iwer';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Step } from '../game/arch-state.js';
import type { HandState } from './hands.js';

type EmulatedHand = NonNullable<XRDevice['hands']['right']>;

export type HandplayPhase = 'waiting' | 'reach' | 'grip' | 'carry' | 'let-go' | 'lever' | 'pull' | 'release' | 'done' | 'failed';

export interface HandplayHook {
  plan: 'solution' | 'trap';
  phase: HandplayPhase;
  step: number;            // index into the plan's steps (steps.length while at the centering)
  steps: number;
  grabbed: number;         // stones the game took into the hand
  seated: number;          // stones the game seated on a face after the hand let go
  struck: boolean;         // the pull cleared the stones (CenteringSystem)
  pull: number;            // m the centering slid, last seen
  misses: string[];        // what did not happen when it should have (a grab, a snap, a strike)
}

const SPEED = 0.3;          // m/s for the hand between stones
const PULL_SPEED = 0.08;    // m/s while pulling the centering
const MAX_STEP = 0.015;     // m a frame at most
const PINCH_RATE = 4;       // pinch value per second (0 to 1 in 0.25 s) ...
const MAX_PINCH_STEP = 0.1; // ... and per frame at most
const HOVER = 0.07;         // m above a stone or a face before going down to it
const PULL = 0.1;           // m the hand pulls the centering towards the player
const SETTLE = 0.35;        // s to wait after a pinch closes or opens before checking what the game did
const START_DELAY = 1.2;    // s after the board is shown
const TILT = -0.6;          // rad: the right hand's fingers point forward and down, palm down
const LOOK = -0.6;          // rad: the seated player looks down at the desk while building

export class HandPlaySystem extends createSystem({}) {
  private steps: Step[] = [];
  private next = 0;
  private phase: HandplayPhase = 'waiting';
  private path: Vector3[] = [];
  private target = new Vector3();
  private aimed = false;
  private pinch = 0;
  private pinchGoal = 0;
  private wait = START_DELAY;
  private stone?: StoneView;
  private placedBefore = 0;
  private hook!: HandplayHook;
  private pulling = false;
  private v = new Vector3();
  private w = new Vector3();
  private err = new Vector3();
  private q = new Quaternion();

  init(): void {
    const plan = new URLSearchParams(location.search).get('handplay') === 'trap' ? 'trap' : 'solution';
    this.hook = { plan, phase: 'waiting', step: 0, steps: 0, grabbed: 0, seated: 0, struck: false, pull: 0, misses: [] };
    const device = this.globals.emulator as XRDevice | undefined;
    if (!device) return;
    device.primaryInputMode = 'hand';
    // Anyone placing stones looks at them: the head pitches down so the board is mid-view. The surface chain
    // only uses the head's position and its horizontal heading, so the board lands where it would anyway.
    device.quaternion.set(Math.sin(LOOK / 2), 0, 0, Math.cos(LOOK / 2));
    const s = Math.sin(TILT / 2), c = Math.cos(TILT / 2);
    device.hands.right?.quaternion.set(s, 0, 0, c);
    device.hands.left?.quaternion.set(s, 0, 0, c);
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<'left' | 'right', HandState> | undefined;
    const device = this.globals.emulator as XRDevice | undefined;
    const right = device?.hands.right, left = device?.hands.left;
    if (!arch?.state || !hands || !right || !left) return;
    arch.hook.handplay = this.hook;
    if (!this.renderer.xr.isPresenting || !arch.shown) return;
    const h = hands.right;

    if (this.phase === 'waiting') {
      if (!h.tracked) return;
      // The other hand rests on the near left corner of the board, open, out of the way.
      this.toWorld(arch, -0.2, 0.03, 0.14, this.w);
      left.position.set(this.w.x, this.w.y, this.w.z);
      if (!this.aimed) { this.target.copy(h.point); this.aimed = true; }
      this.wait -= delta;
      if (this.wait > 0) return;
      this.steps = this.hook.plan === 'trap' ? arch.def.trap : arch.def.solution;
      this.hook.steps = this.steps.length;
      this.beginStep(arch);
    }
    this.movePinch(right, delta);
    const arrived = this.moveTarget(delta, this.phase === 'pull' ? PULL_SPEED : SPEED);
    this.follow(right, h);
    if (this.phase === 'done' || this.phase === 'failed') return;
    if (this.wait > 0) { this.wait -= delta; return; }

    switch (this.phase) {
      case 'reach': // above the stone, then down onto it, and pinch
        if (!arrived) break;
        this.pinchGoal = 1;
        this.phase = 'grip';
        this.wait = SETTLE;
        break;
      case 'grip': {
        if (this.pinch < 1) break;
        const v = this.stone!;
        if (v.mode !== 'held' || v.heldBy !== 'right') { this.fail(`grab ${v.def.id}`); break; }
        this.hook.grabbed++;
        const face = arch.targets(v).find(t => t.side === this.steps[this.next].side);
        if (!face) { this.fail(`no open ${this.steps[this.next].side} face for ${v.def.id}`); break; }
        // Up, across above the face, down onto it.
        const up = this.v.copy(this.target);
        up.y += HOVER;
        this.toWorld(arch, face.pose.x, face.pose.y, face.pose.z, this.w);
        this.path = [up.clone(), new Vector3(this.w.x, this.w.y + HOVER, this.w.z), this.w.clone()];
        this.phase = 'carry';
        break;
      }
      case 'carry':
        if (!arrived) break;
        this.pinchGoal = 0;
        this.phase = 'let-go';
        this.wait = SETTLE;
        break;
      case 'let-go': {
        if (this.pinch > 0) break;
        const v = this.stone!;
        if (arch.state.placed.length === this.placedBefore + 1 && arch.state.placed.some(p => p.stone.id === v.def.id)) this.hook.seated++;
        else this.hook.misses.push(`snap ${v.def.id} (${v.mode})`);
        this.next++;
        this.hook.step = this.next;
        this.beginStep(arch);
        break;
      }
      case 'lever':
        if (!arrived) break;
        this.pinchGoal = 1;
        this.phase = 'pull';
        this.wait = SETTLE;
        break;
      case 'pull':
        if (this.pinch < 1) break;
        if (!this.pulling) {
          // The pinch has closed on the handle: pull straight towards the player.
          this.pulling = true;
          this.towardsPlayer(arch, this.target, PULL, this.w);
          this.path = [this.w.clone()];
          break;
        }
        this.hook.pull = arch.centering.pull;
        this.hook.struck = arch.centering.struck;
        if (!arrived) break;
        if (!this.hook.struck) this.hook.misses.push(`strike (pulled ${arch.centering.pull.toFixed(3)} m)`);
        this.pinchGoal = 0;
        this.phase = 'release';
        this.wait = SETTLE;
        break;
      case 'release':
        this.hook.pull = arch.centering.pull;
        this.hook.struck = arch.centering.struck;
        if (this.pinch > 0) break;
        // Back off, up and towards the player, so the verdict is in view.
        this.v.copy(this.target);
        this.v.y += 0.12;
        this.towardsPlayer(arch, this.v, 0.08, this.w);
        this.path = [this.w.clone()];
        this.phase = 'done';
        break;
    }
    this.hook.phase = this.phase;
  }

  /** The next stone of the plan, or the centering once every stone is down. */
  private beginStep(arch: ArchRuntime): void {
    this.placedBefore = arch.state.placed.length;
    if (this.next >= this.steps.length) {
      if (arch.state.phase !== 'ready') { this.fail(`arch not closed (${arch.state.phase})`); return; }
      arch.centering.handle.getWorldPosition(this.w);
      this.path = [new Vector3(this.w.x, this.w.y + HOVER, this.w.z), this.w.clone()];
      this.phase = 'lever';
      this.hook.phase = this.phase;
      return;
    }
    const v = arch.stoneById(this.steps[this.next].stone);
    if (!v || v.mode !== 'tray') { this.fail(`stone ${this.steps[this.next].stone} not in the tray`); return; }
    this.stone = v;
    this.toWorld(arch, v.pose.x, v.pose.y, v.pose.z, this.w);
    this.path = [new Vector3(this.w.x, this.w.y + HOVER, this.w.z), this.w.clone()];
    this.phase = 'reach';
    this.hook.phase = this.phase;
  }

  private fail(why: string): void {
    this.hook.misses.push(why);
    this.phase = 'failed';
    this.hook.phase = this.phase;
    this.pinchGoal = 0;
  }

  /** Move the aim point along the path, at most `speed` and MAX_STEP a frame. True once at the path's end. */
  private moveTarget(delta: number, speed: number): boolean {
    let budget = Math.min(speed * delta, MAX_STEP);
    while (this.path.length && budget > 0) {
      const d = this.target.distanceTo(this.path[0]);
      if (d <= budget) { this.target.copy(this.path.shift()!); budget -= d; }
      else { this.target.add(this.err.subVectors(this.path[0], this.target).multiplyScalar(budget / d)); budget = 0; }
    }
    return this.path.length === 0;
  }

  private movePinch(hand: EmulatedHand, delta: number): void {
    const step = Math.min(PINCH_RATE * delta, MAX_PINCH_STEP);
    const p = this.pinchGoal > this.pinch ? Math.min(this.pinchGoal, this.pinch + step) : Math.max(this.pinchGoal, this.pinch - step);
    if (p !== this.pinch) { this.pinch = p; hand.updatePinchValue(p); }
  }

  /**
   * Keep the game's pinch point (between the thumb and index tips, as hands.ts measures it this frame) on the
   * aim point: move the emulated hand by the difference. IWER applies the new position at the next frame.
   */
  private follow(hand: EmulatedHand, h: HandState): void {
    if (!h.tracked || !this.aimed) return;
    this.err.subVectors(this.target, h.point);
    // World to the session's space: undo the player rig's rotation (none here, but stay correct).
    this.err.applyQuaternion(this.player.getWorldQuaternion(this.q).invert());
    const p = hand.position;
    p.set(p.x + this.err.x, p.y + this.err.y, p.z + this.err.z);
  }

  private toWorld(arch: ArchRuntime, x: number, y: number, z: number, out: Vector3): Vector3 {
    return arch.site.localToWorld(out.set(x, y, z));
  }

  /** `from` moved `dist` towards the player along the board's own forward axis (site +z). */
  private towardsPlayer(arch: ArchRuntime, from: Vector3, dist: number, out: Vector3): Vector3 {
    arch.site.worldToLocal(out.copy(from));
    out.z += dist;
    return arch.site.localToWorld(out);
  }
}

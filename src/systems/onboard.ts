// The first minute, without a word of text (rules in src/game/onboarding.ts). On w1-1 a pale ghost
// hand pinches the first stone of the solution out of the tray and seats a see-through copy of it on
// its open face, with a soft touch sound as the fingers meet; the real stones never move. In XR it
// repeats after 12 s of hands in view without a grab, in the desktop mode after 12 s of the mouse
// over the page. Once the arch is closed, a hand near the centering's handle (in the desktop mode,
// the pointer near it on the page) makes the centering glow warm, until the first strike.
// Nothing here runs under ?autotest: the scripted stones are not a player, and nothing is saved.
import { createSystem, Mesh, MeshBasicMaterial, Vector3, type MeshStandardMaterial } from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import {
  cue, GHOST_DURATION, GHOST_LEVEL, GHOST_PINCH_AT, ghostFrame, loadOnboard, saveOnboard, step, type Onboard, type OnboardCue,
  type OnboardEvent,
} from '../game/onboarding.js';
import { browserStorage } from '../game/progress.js';
import { ghostColor, ghostHand, setGhostHandOpen } from '../scene/models.js';
import { playGhostPinch } from '../audio/synth.js';
import type { Pose2 } from '../scene/layout.js';

export const NEAR_HANDLE = 0.15;   // m: a hand this close to the centering's handle lights it
export const NEAR_HANDLE_PX = 160; // desktop: the pointer this close to the handle on the page
const HAND_ALPHA = 0.38;
const STONE_ALPHA = 0.45;
const MAX_STEP = 0.2;              // s: a slow frame never skips through the move
const GLOW = 0xffa040;

export class OnboardSystem extends createSystem({}) {
  private o!: Onboard;
  private storage = browserStorage();
  private off = false;
  private hand!: ReturnType<typeof ghostHand>;
  private stone!: Mesh;
  private show: { t: number; stone: StoneView; side: Side; generation: number; pinched: boolean } | undefined;
  private wasStruck = false;
  private generation = -1;
  private glowing = false;
  private pointer: { x: number; y: number } | undefined;
  private hp = new Vector3();
  private clock = 0;
  private from: Pose2 = { x: 0, y: 0, z: 0, angle: 0, tilt: 0 };
  private to: Pose2 = { x: 0, y: 0, z: 0, angle: 0, tilt: 0 };
  private now: Pose2 = { x: 0, y: 0, z: 0, angle: 0, tilt: 0 };

  init(): void {
    this.off = new URLSearchParams(location.search).has('autotest');
    this.o = loadOnboard(this.storage);
    this.hand = ghostHand();
    this.hand.group.userData.keep = true; // lives on the board across levels
    this.stone = new Mesh(undefined, new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    this.stone.name = 'ghost-hand-stone';
    this.stone.visible = false;
    this.stone.renderOrder = 4;
    this.stone.userData.keep = true;
    const move = (e: PointerEvent) => { this.pointer = { x: e.clientX, y: e.clientY }; };
    const leave = () => { this.pointer = undefined; };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    });
  }

  update(delta: number): void {
    this.clock += delta;
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    if (this.off) { arch.hook.onboard = { cue: 'none', ghostShown: this.o.ghostShown }; return; }
    if (!this.hand.group.parent) arch.site.add(this.hand.group, this.stone);
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    const xr = !!this.renderer.xr.getSession();
    if (arch.generation !== this.generation) { this.generation = arch.generation; this.wasStruck = false; this.halt(); }

    // What the player did since the last frame.
    const held = arch.stones.some(v => v.mode === 'held' || (v.mode === 'tween' && v.tween?.then === 'held'));
    if (held || arch.state.placed.length > 0) this.send({ type: 'grab' });
    const struck = !!arch.centering?.struck;
    if (struck && !this.wasStruck) this.send({ type: 'strike' });
    this.wasStruck = struck;
    const handsVisible = xr ? !!(hands?.left.tracked || hands?.right.tracked) : !!this.pointer && document.visibilityState === 'visible';
    this.o = step(this.o, { type: 'tick', dt: Math.min(delta, 1), handsVisible });

    const c: OnboardCue = cue(this.o, {
      level: arch.def.id, phase: arch.state.phase, handNearCentering: this.nearHandle(arch, xr, hands),
    });
    arch.hook.onboard = { cue: this.show ? 'ghost-grab' : c, ghostShown: this.o.ghostShown };

    if (!this.show && c === 'ghost-grab' && arch.shown) this.start(arch);
    if (this.show) this.animate(arch, delta);
    this.glow(arch, c === 'glow-centering');
  }

  private send(ev: OnboardEvent): void {
    const next = step(this.o, ev);
    if (next === this.o) return;
    this.o = next;
    saveOnboard(this.storage, next);
  }

  private nearHandle(arch: ArchRuntime, xr: boolean, hands: Record<Side, HandState> | undefined): boolean {
    if (arch.state.phase !== 'ready' || !arch.centering || arch.centering.struck) return false;
    if (xr) {
      arch.centering.handle.getWorldPosition(this.hp);
      return !!hands && (['left', 'right'] as const).some(s => hands[s].tracked && hands[s].point.distanceTo(this.hp) < NEAR_HANDLE);
    }
    const at = this.pointer && arch.hook.project?.('lever');
    return !!at && Math.hypot(at.x - this.pointer!.x, at.y - this.pointer!.y) < NEAR_HANDLE_PX;
  }

  /** Begin the move on the solution's first stone (or any tray stone that fits an open face). */
  private start(arch: ArchRuntime): void {
    const first = arch.def.solution[0];
    let v = first ? arch.stones.find(s => s.def.id === first.stone && s.mode === 'tray') : undefined;
    let side: Side | undefined = first?.side;
    if (!v || !side || !arch.targets(v).some(t => t.side === side)) {
      v = arch.stones.find(s => s.mode === 'tray' && arch.targets(s).length > 0);
      side = v ? arch.targets(v)[0].side : undefined;
    }
    if (!v || !side) return;
    this.show = { t: 0, stone: v, side, generation: arch.generation, pinched: false };
    this.stone.geometry = arch.batches[v.batch].mesh.geometry;
    ghostColor(v.def.material, (this.stone.material as MeshBasicMaterial).color);
    this.hand.group.visible = true;
  }

  private animate(arch: ArchRuntime, delta: number): void {
    const p = this.show!;
    // The player reached in, or the board changed: the lesson steps aside at once.
    if (this.o.grabbed || p.generation !== arch.generation || arch.state.phase !== 'building' || !arch.shown) { this.halt(); return; }
    p.t += Math.min(delta, MAX_STEP);
    const f = ghostFrame(p.t);
    const face = arch.targets(p.stone).find(t => t.side === p.side)?.pose;
    if (!face) { this.halt(); return; }
    const home = p.stone.home;
    const lerp = (a: Pose2, b: Pose2, u: number, out: Pose2) => {
      out.x = a.x + (b.x - a.x) * u; out.y = a.y + (b.y - a.y) * u; out.z = a.z + (b.z - a.z) * u;
      out.angle = a.angle + (b.angle - a.angle) * u; out.tilt = a.tilt + (b.tilt - a.tilt) * u;
      return out;
    };
    // The hand comes from above and towards the player, and leaves straight up.
    if (f.from === 'above') lerp(Object.assign(this.from, home, { y: home.y + 0.14, z: home.z + 0.1 }), home, f.u, this.now);
    else if (f.from === 'stone') { lerp(home, face, f.u, this.now); this.now.y += 0.07 * f.lift; }
    else lerp(face, Object.assign(this.to, face, { y: face.y + 0.12, z: face.z + 0.06 }), f.u, this.now);

    this.hand.group.position.set(this.now.x, this.now.y, this.now.z);
    this.hand.material.opacity = HAND_ALPHA * f.alpha;
    setGhostHandOpen(this.hand, f.open);
    if (!p.pinched && p.t >= GHOST_PINCH_AT) { p.pinched = true; playGhostPinch(); }

    const sm = this.stone.material as MeshBasicMaterial;
    this.stone.visible = f.stoneAlpha > 0;
    sm.opacity = STONE_ALPHA * f.stoneAlpha;
    if (this.stone.visible) {
      const at = f.from === 'face' ? face : this.now;
      if (f.from !== 'face') { // the stone turns from lying in the tray to its pose on the face
        lerp(home, face, f.from === 'stone' ? f.u : 0, this.from);
        at.angle = this.from.angle; at.tilt = this.from.tilt;
      }
      this.stone.position.set(at.x, at.y, at.z);
      this.stone.rotation.set(at.tilt, 0, 0);
      this.stone.rotateZ(at.angle);
    }
    if (p.t >= GHOST_DURATION) { this.halt(); this.send({ type: 'ghost-played' }); }
  }

  private halt(): void {
    this.show = undefined;
    this.hand.group.visible = false;
    this.stone.visible = false;
  }

  private glow(arch: ArchRuntime, on: boolean): void {
    const m = arch.centering?.mesh.material as MeshStandardMaterial | undefined;
    if (!m) return;
    if (on) {
      this.glowing = true;
      m.emissive.setHex(GLOW);
      m.emissiveIntensity = 0.18 + 0.14 * Math.sin(this.clock * 5);
    } else if (this.glowing) {
      this.glowing = false;
      m.emissiveIntensity = 0;
    }
  }
}

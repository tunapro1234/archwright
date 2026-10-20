// Gaze mode (accessibility, src/game/a11y.ts), in an XR session with the gaze setting on: the
// head's ray picks a target and a pinch of either hand (or a controller's trigger) confirms it.
// Targets: a stone that may be taken, an open end for the selected stone, the centering's handle,
// the rebuild stone, the share tablet, the level markers and the panel's icons. A thin ring sits on
// the target looked at. Stones go through SelectPlace, the same select-then-seat machine as the
// desktop mouse mode. The centering: look at its handle, pinch and keep the pinch for HOLD_TO_STRIKE;
// it slides out as the hold goes on (the ring stays on the handle, wherever the eyes go) and strikes
// at the end. Let go early and it stays where it got to.
// With gaze off, in an XR session, the ray watches the gaze icon alone: looked at for GAZE_WAKE_DWELL, the ring comes
// up on it and a pinch of either hand (or a trigger) turns gaze on, for a player who cannot reach the panel. A pinch
// before that is left to the hands.
// A pinch with nothing looked at is left to the hands, so direct play still works. What is looked at goes to
// runtime.gaze, so the hover mark (grab-snap.ts hoverStone) shows the stone a pinch would confirm, and to
// __archwright.gaze for the emulator test.
import { createSystem, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from '@iwsdk/core';
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import type { LoopPicker } from './loop.js';
import { A11Y_TARGETS, type A11yKey, type A11yPanel } from './a11y.js';
import { SelectPlace } from './select.js';
import { playCue } from '../audio/synth.js';
import { grabCue } from '../audio/music.js';
import { GAZE_WAKE_DWELL, gazePick, gazeWake, holdPull, HOLD_TO_STRIKE, type GazeTarget } from '../game/a11y.js';
import { A11Y_ICONS, CENTERING, strikePull } from '../scene/layout.js';
import { paint } from '../scene/palette.js';

export const GAZE_RANGE = 1.5;   // m
const FACE_R = 0.022;            // pick radius of an open end
const LEVER_R = 0.035;           // ... of the centering's handle
const STONE_R = [0.016, 0.03];   // a stone's pick radius: 70 % of its bounding sphere, within this
const ICON_R = 0.011;
const MAX_TARGETS = 64;
const WAKE_STEP = 0.25;            // s: the most one frame adds to the dwell on the gaze icon
const WAKE_ONLY = [A11Y_TARGETS.gaze];

let ringParts: { geo: RingGeometry; mat: MeshBasicMaterial } | undefined;

/**
 * A thin ring of unit radius in the pinch colour, drawn over everything, hidden until placed: the mark on a target.
 * Every ring shares one geometry and one material (gaze mode's and the hands' spot mark, src/systems/spot-hover.ts).
 */
export function targetRing(name: string): Mesh {
  if (!ringParts) {
    const mat = new MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    paint(mat.color, 'pinch');
    ringParts = { geo: new RingGeometry(0.88, 1, 40), mat };
  }
  const ring = new Mesh(ringParts.geo, ringParts.mat);
  ring.name = name;
  ring.renderOrder = 11;
  ring.visible = false;
  return ring;
}

const pinchedNow = (h: HandState) => h.tracked && h.pinchStarted;

type Kind = 'stone' | 'face' | 'lever' | 'spot' | 'icon';
interface Target extends GazeTarget { center: Vector3; kind: Kind; stone?: StoneView; side?: Side; icon?: A11yKey }

export class GazeSystem extends createSystem({}) {
  private select!: SelectPlace;
  private active = false;
  private generation = -1;
  private pool: Target[] = [];
  private live: Target[] = [];
  private hit: Target | undefined;
  private lit: Side | undefined;
  private shownFor: StoneView | undefined;
  private hold: { side: Side; t: number; pull0: number } | undefined;
  private dwell = 0;
  private ring!: Mesh;
  private origin = new Vector3();
  private dir = new Vector3();
  private v = new Vector3();
  private spotFn = (id: string, at: Vector3, r: number) => { this.add('spot', id, at, Math.min(r, 0.03)); };

  init(): void {
    this.select = SelectPlace.of(this.globals);
    for (let i = 0; i < MAX_TARGETS; i++) this.pool.push({ id: '', center: new Vector3(), radius: 0, kind: 'spot' });
    this.ring = targetRing('gaze-ring');
    this.world.createTransformEntity(this.ring, { persistent: true });
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    const panel = this.globals.a11y as A11yPanel | undefined;
    if (!arch?.state || !hands) return;
    const active = this.renderer.xr.isPresenting && !!panel?.settings.gaze;
    if (active !== this.active || arch.generation !== this.generation) {
      if (arch.generation !== this.generation) this.select.reset();
      else if (!active) { this.select.drop(arch); this.select.refresh(arch, () => false, false); }
      this.active = active;
      this.generation = arch.generation;
      this.hold = undefined;
      this.hit = this.lit = this.shownFor = undefined;
      this.dwell = 0;
      this.ring.visible = false;
    }
    arch.gaze.on = false;
    arch.gaze.stone = undefined;
    this.publish(arch);
    if (!active) {
      this.wake(arch, hands, panel, delta);
      return;
    }

    this.select.update(arch, delta);
    this.collect(arch, panel!);
    this.player.head.getWorldPosition(this.origin);
    this.player.head.getWorldDirection(this.dir).negate(); // the head looks down its -z
    const id = gazePick(this.origin, this.dir, this.live, GAZE_RANGE);
    this.hit = this.hold ? this.live.find(t => t.kind === 'lever') : id === null ? undefined : this.live.find(t => t.id === id);
    // The selected stone is already up: looking at it (to put it back) marks nothing, as with the mouse.
    arch.gaze.on = !!this.hit;
    arch.gaze.stone = this.hit?.kind === 'stone' && this.hit.stone !== this.select.selected ? this.hit.stone : undefined;
    this.publish(arch);
    this.ghosts(arch);
    this.strikeHold(arch, hands, delta);
    this.showRing();

    for (const side of ['left', 'right'] as const) {
      const h = hands[side];
      if (!h.tracked || !h.pinchStarted || !this.hit) continue;
      h.pinchStarted = false; // taken: the hands' own grab, lever and marker picks do not see it
      this.confirm(arch, panel!, this.hit, side);
      break;
    }
  }

  /** This frame's look into __archwright.gaze. */
  private publish(arch: ArchRuntime): void {
    const g = arch.hook.gaze;
    g.on = arch.gaze.on;
    g.target = arch.gaze.on ? this.hit?.id ?? null : null;
    g.stone = arch.gaze.stone?.def.id ?? null;
    g.wake = this.dwell;
  }

  /**
   * Gaze off: the head's ray against the gaze icon alone (nothing in front of it blocks the look). Once it has rested
   * there GAZE_WAKE_DWELL the ring shows on the icon, and a pinch then turns gaze on and is taken; until then a pinch
   * is left to the hands. Outside XR, or with no panel on view, nothing is watched.
   */
  private wake(arch: ArchRuntime, hands: Record<Side, HandState>, panel: A11yPanel | undefined, delta: number): void {
    this.live.length = 0;
    let looking = false;
    if (panel && this.renderer.xr.isPresenting) {
      const at = panel.iconAt('gaze', this.v);
      if (at) this.add('icon', A11Y_TARGETS.gaze, at, ICON_R);
      if (this.live.length) {
        this.player.head.getWorldPosition(this.origin);
        this.player.head.getWorldDirection(this.dir).negate();
        looking = gazePick(this.origin, this.dir, this.live, GAZE_RANGE, WAKE_ONLY) !== null;
      }
    }
    const side: Side | undefined = pinchedNow(hands.left) ? 'left' : pinchedNow(hands.right) ? 'right' : undefined;
    const w = gazeWake(this.dwell, looking, side !== undefined, Math.min(delta, WAKE_STEP));
    this.dwell = w.dwell;
    this.hit = looking && w.dwell >= GAZE_WAKE_DWELL ? this.live[0] : undefined;
    this.showRing();
    if (w.on && side) {
      hands[side].pinchStarted = false; // taken: the hands' own picks do not see it
      this.dwell = 0;
      this.hit = undefined;
      this.ring.visible = false;
      panel!.toggle('gaze');
    }
    arch.hook.gaze.wake = this.dwell;
  }

  /** What may be looked at now, into this.live (no allocation once the pool is warm). */
  private collect(arch: ArchRuntime, panel: A11yPanel): void {
    this.live.length = 0;
    if (!arch.shown) return;
    const sel = this.select.selected;
    if (SelectPlace.canBuild(arch)) {
      for (const v of arch.stones) {
        // With a stone up: itself (put it back), the tray (switch) and its open ends; not the arch.
        if (sel && v !== sel && v.mode === 'placed') continue;
        if (!this.select.pickable(arch, v)) continue;
        const geo = arch.batches[v.batch].mesh.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const r = Math.min(STONE_R[1], Math.max(STONE_R[0], 0.7 * geo.boundingSphere!.radius));
        const t = this.add('stone', v.def.id, arch.siteToWorld(v.pose, this.v), r);
        if (t) t.stone = v;
      }
      if (sel) {
        for (const side of ['left', 'right'] as const) {
          const pose = this.select.faces[side];
          if (!pose) continue;
          const t = this.add('face', side === 'left' ? 'face:left' : 'face:right', arch.siteToWorld(pose, this.v), FACE_R);
          if (t) t.side = side;
        }
      }
    }
    const c = arch.centering;
    if (c && arch.state.placed.length > 0 && !c.struck) this.add('lever', 'lever', c.handle.getWorldPosition(this.v), LEVER_R);
    (this.globals.loop as LoopPicker | undefined)?.forEachSpot(this.spotFn);
    for (const k of A11Y_ICONS) {
      const at = panel.iconAt(k, this.v);
      const t = at && this.add('icon', A11Y_TARGETS[k], at, ICON_R);
      if (t) t.icon = k;
    }
  }

  private add(kind: Kind, id: string, at: Vector3, radius: number): Target | undefined {
    const t = this.pool[this.live.length];
    if (!t) return undefined;
    t.kind = kind;
    t.id = id;
    t.center.copy(at);
    t.radius = radius;
    t.stone = undefined;
    t.side = undefined;
    t.icon = undefined;
    this.live.push(t);
    return t;
  }

  /** Ghosts at the selected stone's open ends; the one looked at is shown solid. */
  private ghosts(arch: ArchRuntime): void {
    const lit = this.hit?.kind === 'face' ? this.hit.side : undefined;
    if (lit === this.lit && this.select.selected === this.shownFor) return;
    this.lit = lit;
    this.shownFor = this.select.selected;
    this.select.refresh(arch, side => side === lit);
  }

  private confirm(arch: ArchRuntime, panel: A11yPanel, t: Target, side: Side): void {
    if (t.kind === 'stone' && t.stone) {
      // Lifted: the same knock as a click in desktop mode (a second pick puts it back, sliding home: ArchRuntime.sendHome).
      if (this.select.pick(arch, t.stone) && this.select.selected === t.stone) playCue(grabCue(t.stone.def.material));
    } else if (t.kind === 'face' && t.side) this.select.seat(arch, t.side);
    else if (t.kind === 'icon' && t.icon) panel.toggle(t.icon);
    else if (t.kind === 'spot') (this.globals.loop as LoopPicker | undefined)?.pick(t.center);
    else if (t.kind === 'lever') {
      this.select.drop(arch);
      this.hold = { side, t: 0, pull0: arch.centering.pull };
    }
    this.shownFor = undefined; // the selection may have changed: refresh the ghosts next frame
  }

  /** A pinch begun on the handle and kept: the centering slides out, and strikes after HOLD_TO_STRIKE. */
  private strikeHold(arch: ArchRuntime, hands: Record<Side, HandState>, delta: number): void {
    const hold = this.hold;
    if (!hold) return;
    const c = arch.centering;
    if (c.struck || !hands[hold.side].pinching || !this.hit) { this.hold = undefined; return; }
    hold.t += delta;
    c.pull = holdPull(hold.t, hold.pull0, strikePull(arch.def.depth), CENTERING.maxPull);
  }

  /** The ring on the target looked at, facing the eyes; it closes in as a strike hold runs. */
  private showRing(): void {
    const t = this.hit;
    this.ring.visible = !!t;
    if (!t) return;
    const k = this.hold ? 1 - 0.45 * Math.min(1, this.hold.t / HOLD_TO_STRIKE) : 1;
    this.ring.position.copy(t.center);
    this.ring.lookAt(this.origin);
    this.ring.scale.setScalar(t.radius * 1.15 * k);
    this.ring.updateMatrixWorld();
  }
}

// The loop around one level. A held arch is crossed by a small passenger, then its stones fade and
// the next level is set up. A collapsed one offers a rebuild stone after a moment: pinch it and the
// same level starts again with the same tray. Small stones beside the board open any level the
// player has reached (solid: solved, hollow: open, lifted and lit: the one on the board).
// Progress is saved in localStorage (src/game/progress.ts) and the game reopens where it left off.
// The desktop mouse mode reaches the same rebuild stone and markers through globals.loop (LoopPicker).
// Under ?autotest the arch stays held or collapsed: the passenger may cross, but nothing is saved
// and no other level is loaded.
import { Color, createSystem, Group, Matrix4, Quaternion, Vector3, type Mesh } from '@iwsdk/core';
import { ArchRuntime } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import {
  browserStorage, loadProgress, nextLevel, recordWin, saveProgress, unlocked, type Progress, type ProgressStorage,
} from '../game/progress.js';
import { LEVELS } from '../levels/index.js';
import { along, markerSpots, passengerPath } from '../scene/layout.js';
import type { Vec2 } from '../statics/index.js';
import { levelMarkers, passengerMesh, rebuildStone } from '../scene/models.js';
import { PALETTE } from '../scene/palette.js';
import { SILENCE } from './statics.js';
import { playTick } from '../audio/synth.js';

export const PASSENGER_DELAY = SILENCE + 0.8; // the line of thrust has faded in
export const PASSENGER_WALK = 3.0;
export const FADE_OUT = 0.6;
export const REBUILD_AFTER = 2.0;
export const PICK_RADIUS = 0.03;              // a pinch this close to a marker or the rebuild stone takes it
const REBUILD_AT = new Vector3(0, 0.1, 0.09);  // site frame: above the board, in front of the arch
const MARKER_LIFT = 0.006;

/** What the desktop mouse mode needs from the loop: the same picks a pinch makes. */
export interface LoopPicker {
  /** A pick at `point` (world): the rebuild stone or a level marker within PICK_RADIUS. */
  pick(point: Vector3): boolean;
  /** World position of the rebuild stone while it is offered, else null. */
  rebuildAt(out: Vector3): Vector3 | null;
}

export class GameLoopSystem extends createSystem({}) {
  private storage: ProgressStorage | null = null;
  private progress!: Progress;
  private autotest = false;
  private root = new Group();
  private passenger!: Mesh;
  private rebuild!: Group;
  private markers!: ReturnType<typeof levelMarkers>;
  private spots = markerSpots(LEVELS.map(l => l.id));
  private open = new Set<string>();
  private generation = -1;
  private verdict: 'none' | 'held' | 'collapsed' = 'none';
  private t = 0;
  private path: Vec2[] = [];
  private at: Vec2 = { x: 0, y: 0 };
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();
  private c = new Color();

  init(): void {
    this.autotest = new URLSearchParams(location.search).has('autotest');
    this.storage = browserStorage();
    this.progress = loadProgress(this.storage);
    this.root.name = 'loop';
    this.root.userData.keep = true; // survives ArchRuntime.load
    this.passenger = passengerMesh();
    this.markers = levelMarkers(this.spots.length);
    this.markers.filled.frustumCulled = this.markers.hollow.frustumCulled = false; // instances come and go
    this.root.add(this.passenger, this.markers.filled, this.markers.hollow);
    const picker: LoopPicker = {
      pick: point => {
        const arch = this.globals.arch as ArchRuntime | undefined;
        return !!arch?.state && this.pinch(arch, point);
      },
      rebuildAt: out => (this.rebuild?.visible ? this.rebuild.getWorldPosition(out) : null),
    };
    this.globals.loop = picker;
  }

  update(delta: number): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    if (!arch?.state) return;
    if (!this.rebuild) {
      this.rebuild = rebuildStone(arch.abutmentMat);
      this.rebuild.position.copy(REBUILD_AT);
      this.root.add(this.rebuild);
      arch.site.add(this.root);
    }
    if (arch.generation !== this.generation) this.reset(arch);

    const state = arch.hook.state;
    if (this.verdict === 'none' && (state === 'held' || state === 'collapsed')) this.onVerdict(arch, state);
    if (this.verdict !== 'none') this.t += delta;
    if (this.verdict === 'held') this.afterHold(arch);
    else if (this.verdict === 'collapsed') this.afterCollapse();

    if (hands) {
      for (const side of ['left', 'right'] as const) {
        const h = hands[side];
        if (h.tracked && h.pinchStarted && this.pinch(arch, h.point)) break;
      }
    }
  }

  private reset(arch: ArchRuntime): void {
    this.generation = arch.generation;
    this.verdict = 'none';
    this.t = 0;
    this.passenger.visible = false;
    this.rebuild.visible = false;
    this.showMarkers(arch.def.id);
  }

  private onVerdict(arch: ArchRuntime, state: 'held' | 'collapsed'): void {
    this.verdict = state;
    this.t = 0;
    if (state !== 'held') return;
    this.path = passengerPath(arch.def, arch.state);
    if (this.autotest) return;
    this.progress = recordWin(this.progress, arch.def.id, arch.state.placed.length, new Date().toISOString());
    saveProgress(this.storage, this.progress);
    this.showMarkers(arch.def.id);
  }

  private afterHold(arch: ArchRuntime): void {
    const walk = (this.t - PASSENGER_DELAY) / PASSENGER_WALK;
    if (walk < 0) return;
    if (walk <= 1) {
      along(this.path, walk, this.at);
      this.passenger.visible = true;
      // A light step: up and down twice per stride, about eight strides across.
      this.passenger.position.set(this.at.x, this.at.y + 0.0015 * Math.abs(Math.sin(walk * Math.PI * 8)), 0);
      return;
    }
    this.passenger.visible = false;
    const next = nextLevel(arch.def.id);
    if (this.autotest || !next) return;
    const fade = 1 - (this.t - PASSENGER_DELAY - PASSENGER_WALK) / FADE_OUT;
    if (fade > 0) arch.setFade(fade);
    else arch.load(ArchRuntime.levelById(next));
  }

  private afterCollapse(): void {
    const k = (this.t - REBUILD_AFTER) / 0.3;
    if (k < 0) return;
    this.rebuild.visible = true;
    this.rebuild.scale.setScalar(Math.min(1, k));
    this.rebuild.position.y = REBUILD_AT.y + 0.004 * Math.sin(this.t * 2);
  }

  /** A pinch began at `point` (world): take the rebuild stone or a level marker. */
  private pinch(arch: ArchRuntime, point: Vector3): boolean {
    if (!arch.shown) return false;
    if (this.rebuild.visible && this.rebuild.getWorldPosition(this.v).distanceTo(point) < PICK_RADIUS) {
      playTick();
      arch.load(arch.def);
      return true;
    }
    for (const spot of this.spots) {
      if (!this.open.has(spot.id)) continue;
      arch.site.localToWorld(this.v.set(spot.x, 0.006, spot.z));
      if (this.v.distanceTo(point) >= PICK_RADIUS) continue;
      if (spot.id === arch.def.id && arch.state.placed.length === 0) return true;
      playTick();
      arch.load(ArchRuntime.levelById(spot.id));
      return true;
    }
    return false;
  }

  private showMarkers(current: string): void {
    const open = unlocked(this.progress);
    // A level opened by ?level= (testers) is shown too, so the board always marks where you are.
    this.open = new Set([...open, current]);
    const { filled, hollow } = this.markers;
    this.spots.forEach((spot, i) => {
      const solved = !!this.progress.solved[spot.id];
      const shown = this.open.has(spot.id);
      const here = spot.id === current;
      this.v.set(spot.x, here ? MARKER_LIFT : 0, spot.z);
      this.c.setHex(here ? PALETTE.pinch : solved ? PALETTE.sandstone : PALETTE.tuff);
      for (const [mesh, on] of [[filled, shown && solved], [hollow, shown && !solved]] as const) {
        this.s.setScalar(on ? 1 : 0);
        mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
        mesh.setColorAt(i, this.c);
      }
    });
    for (const mesh of [filled, hollow]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}

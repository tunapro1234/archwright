// The loop around one level. A held arch is crossed by a small passenger, then its stones fade and
// the next level is set up. A collapsed one offers a rebuild stone after a moment: pinch it and the
// same level starts again with the same tray. Small stones beside the board open any level the
// player has reached (solid: solved, hollow: open, lifted and lit: the one on the board).
// Progress is saved in localStorage (src/game/progress.ts) and the game reopens where it left off.
// A round stone beside the markers opens Today's Span (src/game/daily.ts). A daily level is not
// part of the progress and leads to no next level: once struck, a small tablet rises on the board
// with the day's card (one tile per stone); a pinch on it copies the card to the clipboard, and
// where the page may not write there the tablet only shakes.
// The desktop mouse mode reaches the same rebuild stone and markers through globals.loop (LoopPicker).
// Under ?autotest the arch stays held or collapsed: the passenger may cross, but nothing is saved
// and no other level is loaded.
import { Color, createSystem, Group, Matrix4, Quaternion, Vector3, type Mesh, type MeshStandardMaterial } from '@iwsdk/core';
import { ArchRuntime } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import {
  browserStorage, loadProgress, nextLevel, recordWin, saveProgress, unlocked, type Progress, type ProgressStorage,
} from '../game/progress.js';
import { LEVELS } from '../levels/index.js';
import { dailyDate, dailyHeld, dailyNumber, localDateISO, saveDailyHeld, shareCard } from '../game/daily.js';
import { ringOrder } from '../game/arch-state.js';
import { along, dailySpot, markerSpots, passengerPath, TABLET } from '../scene/layout.js';
import type { Vec2 } from '../statics/index.js';
import { dailyMarker, levelMarkers, passengerMesh, rebuildStone, shareTablet } from '../scene/models.js';
import { MATERIAL_COLOR } from '../scene/meshes.js';
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
const TABLET_AFTER = 1.6;                      // s after the verdict: the tablet rises
const TABLET_RISE = 0.4;
const TABLET_PICK = 0.045;                     // a pinch this close to the tablet's face takes it
const WOBBLE = 0.6;                            // s the tablet shakes when the copy is refused
// At most this much loop time per frame, so on a very slow frame (software rendering) the passenger
// still walks and the held arch is still on view for a while before the next level replaces it.
const MAX_STEP = 0.1;

/** What the desktop mouse mode needs from the loop: the same picks a pinch makes. */
export interface LoopPicker {
  /** A pick at `point` (world): the rebuild stone or a level marker within PICK_RADIUS. */
  pick(point: Vector3): boolean;
  /** World position of the rebuild stone while it is offered, else null. */
  rebuildAt(out: Vector3): Vector3 | null;
  /** World position of the share tablet's face while it is up, else null. */
  tabletAt(out: Vector3): Vector3 | null;
  /** World position of the Today's Span marker. */
  dailyAt(out: Vector3): Vector3 | null;
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
  private daily!: Mesh;
  private todaySpot = dailySpot(LEVELS.map(l => l.id));
  private tablet!: ReturnType<typeof shareTablet>;
  private card: string | null = null;
  private wobble = 0;
  private hop = 0;
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
    this.daily = dailyMarker();
    this.root.add(this.passenger, this.markers.filled, this.markers.hollow, this.daily);
    const picker: LoopPicker = {
      pick: point => {
        const arch = this.globals.arch as ArchRuntime | undefined;
        return !!arch?.state && this.pinch(arch, point);
      },
      rebuildAt: out => (this.rebuild?.visible ? this.rebuild.getWorldPosition(out) : null),
      tabletAt: out => (this.tablet?.group.visible ? this.tabletFace(out) : null),
      dailyAt: out => (this.rebuild ? this.daily.getWorldPosition(out) : null),
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
      this.tablet = shareTablet(arch.abutmentMat);
      this.tablet.group.position.set(TABLET.x, 0, TABLET.z);
      this.root.add(this.tablet.group);
      arch.site.add(this.root);
    }
    if (arch.generation !== this.generation) this.reset(arch);

    const state = arch.hook.state;
    if (this.verdict === 'none' && (state === 'held' || state === 'collapsed')) this.onVerdict(arch, state);
    if (this.verdict !== 'none') this.t += Math.min(delta, MAX_STEP);
    if (this.verdict === 'held') this.afterHold(arch);
    else if (this.verdict === 'collapsed') this.afterCollapse();
    if (this.card) this.animateTablet(delta);

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
    this.tablet.group.visible = false;
    this.card = null;
    const date = dailyDate(arch.def.id);
    arch.hook.daily = date ? { number: dailyNumber(date), card: null } : null;
    this.showMarkers(arch.def.id);
  }

  private onVerdict(arch: ArchRuntime, state: 'held' | 'collapsed'): void {
    this.verdict = state;
    this.t = 0;
    const date = dailyDate(arch.def.id);
    if (date) this.showCard(arch);
    if (state !== 'held') return;
    this.path = passengerPath(arch.def, arch.state);
    if (this.autotest) return;
    if (date) {
      // Today's Span stays out of the progress: only "held today" is remembered, for its marker.
      saveDailyHeld(this.storage, date, arch.state.placed.length);
      this.showMarkers(arch.def.id);
      return;
    }
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

  /** A pinch began at `point` (world): take the rebuild stone, the share tablet or a level marker. */
  private pinch(arch: ArchRuntime, point: Vector3): boolean {
    if (!arch.shown) return false;
    if (this.rebuild.visible && this.rebuild.getWorldPosition(this.v).distanceTo(point) < PICK_RADIUS) {
      playTick();
      arch.load(arch.def);
      return true;
    }
    if (this.tablet.group.visible && this.tabletFace(this.v).distanceTo(point) < TABLET_PICK) {
      this.share();
      return true;
    }
    if (this.daily.getWorldPosition(this.v).distanceTo(point) < PICK_RADIUS) {
      if (arch.def.id === `daily-${localDateISO()}` && arch.state.placed.length === 0) return true;
      playTick();
      arch.load(ArchRuntime.levelById('today'));
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
    // Today's Span: always open; solid sandstone once today's arch has held on this device.
    const today = localDateISO();
    const here = current === `daily-${today}`;
    this.daily.position.set(this.todaySpot.x, here ? MARKER_LIFT : 0, this.todaySpot.z);
    (this.daily.material as MeshStandardMaterial).color.setHex(
      here ? PALETTE.pinch : dailyHeld(this.storage, today) ? PALETTE.sandstone : PALETTE.tuff);
  }

  /** The card of the struck daily arch: tiles on the tablet, the hook, and the tablet to rise. */
  private showCard(arch: ArchRuntime): void {
    this.card = shareCard(arch.state);
    if (arch.hook.daily) arch.hook.daily.card = this.card;
    const ring = ringOrder(arch.state);
    const { tiles } = this.tablet;
    const n = Math.min(ring.length, tiles.instanceMatrix.count);
    const step = TABLET.tile + TABLET.tileGap;
    const fell = arch.state.phase === 'collapsed';
    for (let i = 0; i < n; i++) {
      // Held: a straight row. Fell: the same row, slipped and askew.
      const x = (i - (n - 1) / 2) * step;
      const y = TABLET.height * 0.5 + (fell ? -0.004 * ((i * 7) % 3) : 0);
      this.q.setFromAxisAngle(this.v.set(0, 0, 1), fell ? 0.35 * (((i * 5) % 3) - 1) : 0);
      tiles.setMatrixAt(i, this.m.compose(this.v.set(x, y, 0), this.q, this.s.setScalar(1)));
      tiles.setColorAt(i, this.c.setHex(MATERIAL_COLOR[ring[i].stone.material]));
    }
    this.q.identity();
    tiles.count = n;
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    this.wobble = this.hop = 0;
  }

  private animateTablet(delta: number): void {
    const g = this.tablet.group;
    const k = (this.t - TABLET_AFTER) / TABLET_RISE;
    g.visible = k > 0;
    if (!g.visible) return;
    const rise = Math.min(1, k);
    g.scale.setScalar(rise);
    this.hop = Math.max(0, this.hop - delta);
    g.position.y = 0.006 * Math.sin((this.hop / 0.3) * Math.PI);
    this.wobble = Math.max(0, this.wobble - delta);
    g.rotation.y = this.wobble > 0 ? 0.18 * Math.sin(this.wobble * 40) * (this.wobble / WOBBLE) : 0;
  }

  /** Centre of the tablet's face (world), into `out`. */
  private tabletFace(out: Vector3): Vector3 {
    return this.tablet.face.localToWorld(out.set(0, TABLET.height / 2, TABLET.thickness / 2));
  }

  /** Copies the card to the clipboard: a small hop when it worked, a shake when the page may not. */
  private share(): void {
    const card = this.card;
    const refuse = () => { this.wobble = WOBBLE; };
    if (!card) return;
    try {
      const clip = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
      if (!clip?.writeText) { refuse(); return; }
      clip.writeText(card).then(() => { this.hop = 0.3; playTick(); }, refuse);
    } catch {
      refuse();
    }
  }
}

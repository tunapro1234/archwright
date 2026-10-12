// Select, then seat: the two-step way to build without carrying a stone. Pick a stone and it rises
// off the tray, with a ghost at each open end it may join; pick an end and it seats there. Picking
// the stone again puts it back; picking the outermost stone of either half lifts it off the arch.
// The desktop mouse mode (src/systems/desktop.ts) and the gaze mode (src/systems/gaze.ts) drive this
// one machine; only the input differs (a click, or a look and a pinch). One instance, in
// world.globals.select, and only one of the two modes is active at a time.
import type { ArchRuntime, StoneView } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { Pose2 } from '../scene/layout.js';

export const LIFT = 0.045;      // m a picked stone rises above its tray spot
const LIFT_TIME = 0.22;
const SEAT_TIME = 0.32;
const SIDES = ['left', 'right'] as const;

export class SelectPlace {
  selected: StoneView | undefined;
  /** Pose at each open face the selected stone may join, after refresh(); undefined where it may not. */
  readonly faces: Record<Side, Pose2 | undefined> = { left: undefined, right: undefined };
  private lifted: Pose2 = { x: 0, y: 0, z: 0, angle: 0, tilt: 0 };
  private t = 0;

  /** The shared machine, made on first use. */
  static of(globals: Record<string, unknown>): SelectPlace {
    return (globals.select ??= new SelectPlace()) as SelectPlace;
  }

  static canBuild(arch: ArchRuntime): boolean {
    return arch.shown && (arch.state.phase === 'building' || arch.state.phase === 'ready');
  }

  /** Each frame while a mode drives it: let go if the arch was struck or something else took the stone. */
  update(arch: ArchRuntime, delta: number): void {
    this.t += delta;
    const s = this.selected;
    if (s && (!SelectPlace.canBuild(arch) || (s.mode !== 'held' && s.mode !== 'tween'))) { this.drop(arch); return; }
    if (s?.mode === 'held') s.pose.y = this.lifted.y + 0.003 * Math.sin(this.t * 3);
  }

  /** A pick on stone `v`: select it, put it back if it was selected, or take it off the arch. */
  pick(arch: ArchRuntime, v: StoneView): boolean {
    if (!SelectPlace.canBuild(arch)) return false;
    if (this.selected === v) { this.drop(arch); return true; }
    const free = v.mode === 'tray' || (v.mode === 'tween' && v.tween?.then === 'tray');
    if (!free) {
      // The outermost stone of either half comes back off the arch, as a pinch would take it.
      if (v.mode !== 'placed' || !this.outermost(arch, v) || !arch.unplace(v)) return false;
    }
    if (this.selected) arch.sendHome(this.selected);
    this.selected = v;
    v.heldBy = undefined;
    Object.assign(this.lifted, v.home);
    this.lifted.y += LIFT;
    arch.tweenTo(v, this.lifted, LIFT_TIME, 0.01, 'held');
    return true;
  }

  /** Whether `v` is a stone a pick would take now (free in the tray, or outermost on the arch). */
  pickable(arch: ArchRuntime, v: StoneView): boolean {
    if (v === this.selected) return true;
    if (v.mode === 'tray' || (v.mode === 'tween' && v.tween?.then === 'tray')) return true;
    return v.mode === 'placed' && this.outermost(arch, v);
  }

  /** A pick on open face `side`: the selected stone seats there. */
  seat(arch: ArchRuntime, side: Side): boolean {
    const v = this.selected;
    if (!v || !SelectPlace.canBuild(arch) || !this.faces[side]) return false;
    this.selected = undefined;
    arch.place(v, side, SEAT_TIME, 0.03);
    return true;
  }

  /** The selected stone goes back to its tray spot. */
  drop(arch: ArchRuntime): void {
    const v = this.selected;
    this.selected = undefined;
    if (v && (v.mode === 'held' || v.mode === 'tween')) arch.sendHome(v);
  }

  /** Forget the selection without moving anything (a new level: the old stones are gone). */
  reset(): void {
    this.selected = undefined;
    this.faces.left = this.faces.right = undefined;
  }

  /**
   * Open faces for the selected stone (into this.faces), with a ghost at each; `firm(side)` shows
   * that ghost solid (hovered or looked at). With `shown` false, or no selection, no faces and no ghosts.
   */
  refresh(arch: ArchRuntime, firm: (side: Side) => boolean, shown = true): void {
    const v = shown ? this.selected : undefined;
    const targets = v ? arch.targets(v) : [];
    for (const side of SIDES) {
      const t = targets.find(q => q.side === side);
      this.faces[side] = t?.pose;
      if (!v || !t) arch.hideGhost(side);
      else arch.showGhost(side, v, t.pose, firm(side) ? 1 : 0.4);
    }
  }

  private outermost(arch: ArchRuntime, v: StoneView): boolean {
    const placed = arch.state.placed;
    return SIDES.some(side => {
      for (let i = placed.length - 1; i >= 0; i--) if (placed[i].side === side) return placed[i].stone.id === v.def.id;
      return false;
    });
  }
}

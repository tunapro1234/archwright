// The spot mark in an XR session: before a pinch, the level marker, Today's Span marker, rebuild stone, share tablet
// or accessibility icon that a hand is over gets the thin ring gaze mode puts on what the eyes are on (the same
// geometry and material, src/systems/gaze.ts targetRing), so these small targets are not pinched blind. The hand's
// point is its pinch point, as for the stones (grab-snap.ts). A stone comes first: a hand that has the stone mark,
// is pinching, has its palm up (its pinch is the system gesture) or is not tracked marks no spot, and in gaze mode
// no hand does, since there a pinch confirms what the eyes are on (src/game/a11y.ts handAim, nearestSpot).
// A spot's reach is its pick radius (loop.ts PICK_RADIUS, a11y.ts ICON_PICK, the tablet's) and the mark is let go past
// it, so the ring only ever marks what a pinch there takes.
// The pinch is taken here too, with the same choice: each hand's spot (handAim, kept per hand) is what its pinch takes
// when it begins, and a hand with no spot takes none (a pinch is never matched against the spots any other way). The
// ring is on the nearer hand's spot. __archwright.handHover reports the ring, __archwright.pinchTarget each hand's
// spot, __archwright.spots() the spots with their world centres.
import { createSystem, Mesh, Vector3 } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import type { LoopPicker } from './loop.js';
import { A11Y_TARGETS, ICON_PICK, type A11yKey, type A11yPanel } from './a11y.js';
import { targetRing } from './gaze.js';
import { SpotList, type Spot } from './spots.js';
import { handAim, type SpotHand } from '../game/a11y.js';
import { A11Y_ICONS } from '../scene/layout.js';

const SIDES = ['left', 'right'] as const;

interface Hand extends SpotHand { point: Vector3 }

export class SpotHoverSystem extends createSystem({}) {
  private spots = new SpotList();
  private hands: Record<Side, Hand> = {
    left: { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() },
    right: { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() },
  };
  private ring!: Mesh;
  private head = new Vector3();
  private v = new Vector3();
  private spotFn = (id: string, at: Vector3, pick: number) => { this.spots.add(id, at, pick); };

  init(): void {
    this.ring = targetRing('spot-ring');
    this.world.createTransformEntity(this.ring, { persistent: true });
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (arch) {
      arch.hook.spots = () => {
        const panel = this.globals.a11y as A11yPanel | undefined;
        if (panel) this.collect(panel);
        return this.spots.live.map(s => ({ id: s.id, x: s.center.x, y: s.center.y, z: s.center.z }));
      };
    }
  }

  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    const panel = this.globals.a11y as A11yPanel | undefined;
    if (!arch?.state) return;
    const aim = arch.hook.pinchTarget;
    let ring: Spot | undefined;
    if (hands && panel && this.renderer.xr.isPresenting && arch.shown) {
      this.collect(panel);
      // A pinch that begins now takes the spot this hand had (its ring, last frame), and only that one.
      for (const side of SIDES) {
        const h = hands[side];
        if (aim[side] && h.tracked && h.pinchStarted && !holding(arch, side) && this.take(aim[side]!, panel)) {
          h.pinchStarted = false; // taken: no other system sees this pinch
          this.collect(panel); // a level loaded or the board changed: its spots now
        }
      }
      let best = Infinity;
      for (const side of SIDES) {
        const h = hands[side], s = this.hands[side];
        s.tracked = h.tracked; s.pinching = h.pinching; s.palmUp = h.palmUp; s.stone = !!arch.handStone[side];
        s.point.copy(h.point);
        const t = handAim(s, this.spots.live, aim[side], panel.settings.gaze) as Spot | null;
        aim[side] = t?.id ?? null;
        if (!t) continue;
        const d = t.center.distanceTo(s.point);
        if (d < best) { best = d; ring = t; }
      }
    } else {
      aim.left = aim.right = null;
    }
    arch.hook.handHover = ring?.id ?? null;
    this.show(ring);
  }

  /** Every spot a pinch may take now, into this.spots (no allocation once the pool is warm). */
  private collect(panel: A11yPanel): void {
    this.spots.clear();
    (this.globals.loop as LoopPicker | undefined)?.forEachSpot(this.spotFn);
    for (const k of A11Y_ICONS) {
      const at = panel.iconAt(k, this.v);
      if (at) this.spots.add(A11Y_TARGETS[k], at, ICON_PICK);
    }
  }

  /** A pinch took spot `id`: an icon switches its setting, anything else is the loop's (a marker, rebuild, the tablet). */
  private take(id: string, panel: A11yPanel): boolean {
    if (!this.spots.find(id)) return false; // gone since last frame
    for (const k of A11Y_ICONS) {
      if (A11Y_TARGETS[k as A11yKey] !== id) continue;
      panel.toggle(k);
      return true;
    }
    return !!(this.globals.loop as LoopPicker | undefined)?.take(id);
  }

  /** The ring on the spot, facing the eyes, as wide as the pick's reach; hidden (no draw call) when there is none. */
  private show(s: Spot | undefined): void {
    this.ring.visible = !!s;
    if (!s) return;
    this.player.head.getWorldPosition(this.head);
    this.ring.position.copy(s.center);
    this.ring.lookAt(this.head);
    this.ring.scale.setScalar(2 * s.radius * 1.15);
    this.ring.updateMatrixWorld();
  }
}

/** This hand already holds a stone (its pinch took the stone this frame: a stone comes first). */
function holding(arch: ArchRuntime, side: Side): boolean {
  for (const v of arch.stones) if (v.mode === 'held' && v.heldBy === side) return true;
  return false;
}

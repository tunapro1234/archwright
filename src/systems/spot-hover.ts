// The spot mark in an XR session: before a pinch, the level marker, Today's Span marker, rebuild stone, share tablet
// or accessibility icon that a hand is over gets the thin ring gaze mode puts on what the eyes are on (the same
// geometry and material, src/systems/gaze.ts targetRing), so these small targets are not pinched blind. The hand's
// point is its pinch point, as for the stones (grab-snap.ts). A stone comes first: a hand that has the stone mark,
// is pinching, has its palm up (its pinch is the system gesture) or is not tracked marks no spot, and in gaze mode
// no hand does, since there a pinch confirms what the eyes are on (src/game/a11y.ts handSpot, nearestSpot).
// A spot's reach is its pick radius (loop.ts PICK_RADIUS, a11y.ts ICON_PICK, the tablet's) and the mark is let go past
// it (handSpot), so the ring only ever marks what a pinch there takes. __archwright.handHover reports it.
import { createSystem, Mesh, Vector3 } from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import type { Side } from '../game/arch-state.js';
import type { HandState } from './hands.js';
import type { LoopPicker } from './loop.js';
import { A11Y_TARGETS, ICON_PICK, type A11yPanel } from './a11y.js';
import { targetRing } from './gaze.js';
import { handSpot, type GazeTarget, type SpotHand } from '../game/a11y.js';
import { A11Y_ICONS } from '../scene/layout.js';

const MAX_SPOTS = 40;
const SIDES = ['left', 'right'] as const;

interface Spot extends GazeTarget { center: Vector3 }
interface Hand extends SpotHand { point: Vector3 }

export class SpotHoverSystem extends createSystem({}) {
  private pool: Spot[] = [];
  private live: Spot[] = [];
  private hands: Record<Side, Hand> = {
    left: { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() },
    right: { tracked: false, pinching: false, palmUp: false, stone: false, point: new Vector3() },
  };
  private both = [this.hands.left, this.hands.right];
  private ring!: Mesh;
  private head = new Vector3();
  private v = new Vector3();
  private spotFn = (id: string, at: Vector3, pick: number) => { this.add(id, at, pick); };

  init(): void {
    this.ring = targetRing('spot-ring');
    this.world.createTransformEntity(this.ring, { persistent: true });
  }

  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const hands = this.globals.hands as Record<Side, HandState> | undefined;
    const panel = this.globals.a11y as A11yPanel | undefined;
    if (!arch?.state) return;
    const prev = arch.hook.handHover;
    let id: string | null = null;
    if (hands && panel && this.renderer.xr.isPresenting && arch.shown) {
      this.collect(panel);
      for (const side of SIDES) {
        const h = hands[side], s = this.hands[side];
        s.tracked = h.tracked; s.pinching = h.pinching; s.palmUp = h.palmUp; s.stone = !!arch.handStone[side];
        s.point.copy(h.point);
      }
      id = handSpot(this.both, this.live, prev, panel.settings.gaze);
    }
    arch.hook.handHover = id;
    this.show(id);
  }

  /** Every spot a pinch may take now, into this.live (no allocation once the pool is warm). */
  private collect(panel: A11yPanel): void {
    this.live.length = 0;
    (this.globals.loop as LoopPicker | undefined)?.forEachSpot(this.spotFn);
    for (const k of A11Y_ICONS) {
      const at = panel.iconAt(k, this.v);
      if (at) this.add(A11Y_TARGETS[k], at, ICON_PICK);
    }
  }

  /** A spot a pinch takes within `pick` (m) of its centre. */
  private add(id: string, at: Vector3, pick: number): void {
    const n = this.live.length;
    if (n >= MAX_SPOTS) return;
    const s = (this.pool[n] ??= { id: '', center: new Vector3(), radius: 0 });
    s.id = id;
    s.center.copy(at);
    s.radius = pick / 2; // nearestSpot reaches twice the radius: the pick's own reach

    this.live.push(s);
  }

  /** The ring on the spot, facing the eyes, as wide as the pick's reach; hidden (no draw call) when there is none. */
  private show(id: string | null): void {
    let s: Spot | undefined;
    for (const t of this.live) if (t.id === id) { s = t; break; }
    this.ring.visible = !!s;
    if (!s) return;
    this.player.head.getWorldPosition(this.head);
    this.ring.position.copy(s.center);
    this.ring.lookAt(this.head);
    this.ring.scale.setScalar(2 * s.radius * 1.15);
    this.ring.updateMatrixWorld();
  }
}

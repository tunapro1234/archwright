// The spots a pick may take now (level markers, Today's Span, the rebuild stone, the share tablet, the accessibility
// icons), gathered into one reused list, each with the reach its pick has. A hand's ring and its pinch
// (src/systems/spot-hover.ts), and the mouse and gaze picks (src/systems/loop.ts pick), all choose from such a list with
// the same function (src/game/a11y.ts nearestSpot, handAim), so what is marked is what is taken.
import { Vector3 } from '@iwsdk/core';
import type { GazeTarget } from '../game/a11y.js';

const MAX_SPOTS = 40;

export interface Spot extends GazeTarget { center: Vector3 }

export class SpotList {
  readonly live: Spot[] = [];
  private pool: Spot[] = [];

  clear(): void {
    this.live.length = 0;
  }

  /** A spot a pick takes within `pick` (m) of its centre `at` (copied). No allocation once the pool is warm. */
  add(id: string, at: Vector3, pick: number): void {
    const n = this.live.length;
    if (n >= MAX_SPOTS) return;
    const s = (this.pool[n] ??= { id: '', center: new Vector3(), radius: 0 });
    s.id = id;
    s.center.copy(at);
    s.radius = pick / 2; // nearestSpot reaches twice the radius: the pick's own reach
    this.live.push(s);
  }

  find(id: string | null): Spot | undefined {
    if (id === null) return undefined;
    for (const s of this.live) if (s.id === id) return s;
    return undefined;
  }
}

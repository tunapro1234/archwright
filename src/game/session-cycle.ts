// One page, several XR sessions (AR, out, VR, out, AR), as pure rules (no three.js, no WebXR). A hit-test source of a
// session that has ended may throw on cancel (InvalidStateError); a throw there, inside the frame loop, would stop it.
// So every cancel is guarded and every slot is cleared before its source is cancelled. A collapse under way when the
// player leaves is built again on the way back in, as the rebuild stone does; a level under way otherwise goes along
// to the new surface with its stones.
import type { Phase } from './arch-state.js';
import type { SurfaceInput, SurfaceKind } from '../scene/surface-chain.js';

/** Cancel a hit-test source; a source that cannot be cancelled any more (its session ended) is let go. */
export function safeCancel(s: { cancel(): void }): void {
  try { s.cancel(); } catch { /* the session is gone and the source with it */ }
}

/** Empty every slot, each one before its source is cancelled ('pending' only empties); a second call does nothing. */
export function cancelHitSources<K extends string>(slots: Record<K, { cancel(): void } | null | 'pending'>): void {
  for (const k of Object.keys(slots) as K[]) {
    const s = slots[k];
    slots[k] = null;
    if (s && s !== 'pending') safeCancel(s);
  }
}

/** On a new session after another: build the level again only if its arch is falling or has fallen. */
export function sessionCycleAction(o: { phase: Phase; dynamic: number; collapseRequested: boolean }): 'keep' | 'rebuild' {
  return o.phase === 'collapsed' || o.dynamic > 0 || o.collapseRequested ? 'rebuild' : 'keep';
}

/** The hit-test rings are up only while the board has no place yet in this session and the chain is on pick. */
export function pickingAllowed(o: { placed: SurfaceKind | null; force: SurfaceInput['force']; choice: SurfaceKind }): boolean {
  return o.placed === null && (o.force === 'pick' || o.choice === 'pick');
}

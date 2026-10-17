// Clean pause, as pure rules (no window, no WebXR): the game stops while the player cannot see it, under the
// headset's system menu (the XR session visible-blurred), with the headset off (hidden) or in a hidden tab.
// src/systems/pause.ts applies them to the running world.

export interface PauseInput {
  /** The XR session's visibilityState, null outside XR. */
  xrVisibility: XRVisibilityState | null;
  /** document.visibilityState === 'hidden'. */
  documentHidden: boolean;
}

export function isPaused(i: PauseInput): boolean {
  return i.xrVisibility === 'visible-blurred' || i.xrVisibility === 'hidden' || i.documentHidden;
}

/** s: the first frame after a pause steps at most this, whatever time went by while paused. */
export const RESUME_DT = 0.1;

/** The step for a frame: as it came, or capped at RESUME_DT on the first frame back from a pause. */
export function frameDelta(delta: number, firstAfterPause: boolean): number {
  const d = Math.max(0, delta);
  return firstAfterPause ? Math.min(d, RESUME_DT) : d;
}

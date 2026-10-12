// Screen arithmetic for the desktop mouse mode (src/systems/desktop.ts). Pure, so it is tested in Node.

/** Dragging the centering lever this far down the page (CSS px) pulls it exactly to the strike. */
export const DRAG_PX = 120;

/**
 * Centering pull for a lever drag: `dy` CSS px down the page since the press, which began at `pull0`.
 * DRAG_PX of travel is one full strike pull; dragging back up pushes the centering in again.
 */
export function leverPull(dy: number, pull0: number, strikeAt: number, maxPull: number): number {
  return Math.max(0, Math.min(maxPull, pull0 + (dy / DRAG_PX) * strikeAt));
}

export interface Rect { left: number; top: number; width: number; height: number }

/** A point in normalised device coordinates (three's Vector3.project) on the page, or null behind the camera. */
export function ndcToCss(x: number, y: number, z: number, rect: Rect): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || z < -1 || z > 1) return null;
  return { x: rect.left + ((x + 1) / 2) * rect.width, y: rect.top + ((1 - y) / 2) * rect.height };
}

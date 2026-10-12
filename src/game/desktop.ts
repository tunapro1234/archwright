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

export interface V3 { x: number; y: number; z: number }

/** The desktop camera looks down on the board from this far above the horizontal. */
export const VIEW_ELEVATION = (35 * Math.PI) / 180;
/** Kept-in-view points stay inside this fraction of the half-view (the rest is margin). */
export const VIEW_FILL = 0.86;

/**
 * Desktop camera for a level: from VIEW_ELEVATION above, straight down the board's z axis, as close
 * as it can be with every point inside VIEW_FILL of the view (vertical field of view `fovDeg`,
 * width / height `aspect`). Points, eye and target are in the site frame. The target is shifted
 * until the points sit centred on the screen; the distance is then the least that fits them all.
 */
export function frameView(points: V3[], fovDeg: number, aspect: number, elevation = VIEW_ELEVATION): { eye: V3; target: V3 } {
  const ty = Math.tan((fovDeg * Math.PI) / 360) * VIEW_FILL, tx = ty * aspect;
  const c = Math.cos(elevation), s = Math.sin(elevation);
  // Camera axes: forward f (towards the board), right r, up u.
  const f = { y: -s, z: -c }, u = { y: c, z: -s };
  const n = points.length || 1;
  const T: V3 = { x: 0, y: 0, z: 0 };
  for (const p of points) { T.x += p.x / n; T.y += p.y / n; T.z += p.z / n; }
  const local = (p: V3) => {
    const dx = p.x - T.x, dy = p.y - T.y, dz = p.z - T.z;
    return { x: dx, y: dy * u.y + dz * u.z, depth: dy * f.y + dz * f.z };
  };
  const distance = () => {
    let D = 0.05;
    for (const p of points) {
      const l = local(p);
      D = Math.max(D, Math.abs(l.x) / tx - l.depth, Math.abs(l.y) / ty - l.depth);
    }
    return D;
  };
  let D = distance();
  for (let k = 0; k < 8; k++) {
    // Screen extents at this distance; move the target by half their offset from the centre.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of points) {
      const l = local(p), z = l.depth + D;
      x0 = Math.min(x0, l.x / z); x1 = Math.max(x1, l.x / z);
      y0 = Math.min(y0, l.y / z); y1 = Math.max(y1, l.y / z);
    }
    const mx = ((x0 + x1) / 2) * D, my = ((y0 + y1) / 2) * D;
    T.x += mx; T.y += my * u.y; T.z += my * u.z;
    D = distance();
  }
  return { eye: { x: T.x, y: T.y + s * D, z: T.z + c * D }, target: { ...T } };
}

/**
 * A site-frame point on the page through that camera (no roll, up is +y): CSS px in a `width` by
 * `height` view, or null behind the camera. The same projection three.js makes; for tests.
 */
export function projectView(view: { eye: V3; target: V3 }, fovDeg: number, width: number, height: number, p: V3): { x: number; y: number } | null {
  const f = norm(sub(view.target, view.eye));
  const r = norm({ x: -f.z, y: 0, z: f.x });
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = sub(p, view.eye);
  const z = dot(d, f);
  if (z <= 0) return null;
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const nx = dot(d, r) / (z * t * (width / height)), ny = dot(d, u) / (z * t);
  return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

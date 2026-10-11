// Where everything sits on the board, in metres. Pure maths (no three.js) so it is unit-tested.
//
// Site frame: origin at the centre of the board's top face, x to the player's right, y up,
// +z towards the player. The arch stands in the x-y plane at z = 0; its own frame ("arch frame",
// the solver's frame) is the site frame lifted by ABUTMENT_HEIGHT, so springings sit on the
// abutments. The tray holds the loose stones in rows in front of the arch, lying face up so their
// wedge shape reads from above; the centering slides out towards +z, stopping short of the tray.
import { ringArch, type Vec2 } from '../statics/index.js';
import type { GameState, LevelDef, StoneDef } from '../game/arch-state.js';

export const ABUTMENT_HEIGHT = 0.05;
export const ABUTMENT_SPARE = 0.025;  // abutment width beyond the thickest stone
export const BOARD = { width: 0.46, zMin: -0.08, zMax: 0.3, thickness: 0.012 };
// TRAY.z: far edge (towards the arch) of the first row; rowGap: clear space between rows.
export const TRAY = { z: 0.15, rowGap: 0.015, maxWidth: 0.42, gap: 0.012 };
export const CENTERING = { handleDepth: 0.03, strikeExtra: 0.012, maxPull: 0.085 };
export const LYING = -Math.PI / 2; // tilt of a stone lying face up in the tray

/**
 * A stone's pose: position (x, y in the arch plane, z across it), rotation `angle` about z, and
 * `tilt` about x applied before it (0 standing in the arch plane, LYING flat in the tray).
 */
export interface Pose2 { x: number; y: number; z: number; angle: number; tilt: number }

/**
 * Outline of `stone` in its own frame: x along the arch, y radially outwards, origin at the
 * centroid. The same outline serves the tray (angle 0: the stone stands like a keystone) and every
 * slot of a semicircular ring, where all stones of one kind are congruent.
 */
export function stoneOutline(geo: GameState['geometry'], stone: StoneDef): Vec2[] {
  return toLocal(blockAt(geo, stone, 0)).outline;
}

/** Pose of `stone` seated at course `slot`, in the site frame. */
export function slotPose(geo: GameState['geometry'], stone: StoneDef, slot: number): Pose2 {
  const { centroid, angle } = toLocal(blockAt(geo, stone, slot));
  return { x: centroid.x, y: centroid.y + ABUTMENT_HEIGHT, z: 0, angle, tilt: 0 };
}

/** Pose for a stone joining `side` of the arch right now. */
export function facePose(s: GameState, stone: StoneDef, side: 'left' | 'right'): Pose2 {
  const slot = side === 'left' ? s.left : s.geometry.units - s.right - stone.units;
  return slotPose(s.geometry, stone, slot);
}

/**
 * Tray positions, in tray order: rows of stones lying face up, centred across the board. A lying
 * stone's local y (out of the ring) points away from the player, so it lies as it will stand.
 */
export function trayPoses(def: LevelDef): Pose2[] {
  const geo = { span: def.span, rise: def.rise, units: def.stones, depth: def.depth };
  const boxes = def.tray.map(s => bounds(stoneOutline(geo, s)));
  const rows: number[][] = [[]];
  let width = 0;
  boxes.forEach((b, i) => {
    const w = b.maxX - b.minX;
    if (rows[rows.length - 1].length && width + TRAY.gap + w > TRAY.maxWidth) { rows.push([]); width = 0; }
    width += (rows[rows.length - 1].length ? TRAY.gap : 0) + w;
    rows[rows.length - 1].push(i);
  });
  const out: Pose2[] = new Array(def.tray.length);
  let z0 = TRAY.z;
  for (const row of rows) {
    const total = row.reduce((a, i) => a + boxes[i].maxX - boxes[i].minX, 0) + TRAY.gap * (row.length - 1);
    const rowDepth = Math.max(...row.map(i => boxes[i].maxY - boxes[i].minY));
    let x = -total / 2;
    for (const i of row) {
      const b = boxes[i];
      // Lying, local y maps to -z: the stone covers z in [pose.z - maxY, pose.z - minY].
      out[i] = { x: x - b.minX, y: def.depth / 2, z: z0 + rowDepth / 2 + (b.maxY + b.minY) / 2, angle: 0, tilt: LYING };
      x += b.maxX - b.minX + TRAY.gap;
    }
    z0 += rowDepth + TRAY.rowGap;
  }
  return out;
}

/** Abutment boxes (site frame): centre x, width, height; one per side. */
export function abutments(def: LevelDef): { x: number; width: number; height: number }[] {
  const tMax = Math.max(...def.tray.map(s => s.t));
  const width = tMax + ABUTMENT_SPARE;
  const x = def.span / 2 + width / 2;
  return [{ x: -x, width, height: ABUTMENT_HEIGHT }, { x, width, height: ABUTMENT_HEIGHT }];
}

/** The centering's top: the intrados from left springing to right, in the arch frame. */
export function intrados(span: number, rise: number, segments: number): Vec2[] {
  const arch = ringArch({ span, rise, units: segments, pieces: Array.from({ length: segments }, () => ({ units: 1, t: 0.001 })) });
  return arch.joints.map(j => ({ ...j[0] }));
}

/** Pull distance at which the centering clears the stones and the arch is struck. */
export const strikePull = (depth: number): number => depth + CENTERING.strikeExtra;

// --- helpers ---------------------------------------------------------------------------------

function blockAt(geo: GameState['geometry'], stone: StoneDef, slot: number): Vec2[] {
  const pieces = [];
  for (let k = 0; k < slot; k++) pieces.push({ units: 1, t: stone.t });
  pieces.push({ units: stone.units, t: stone.t });
  for (let k = slot + stone.units; k < geo.units; k++) pieces.push({ units: 1, t: stone.t });
  return ringArch({ span: geo.span, rise: geo.rise, units: geo.units, pieces }).blocks[slot].vertices;
}

// Block vertices are [inner0, inner1, outer1, outer0], left to right along the ring. Local x runs
// along the inner edge, local y points out of the ring (so the crown stone has angle 0); the origin
// is the polygon's centroid.
function toLocal(v: Vec2[]): { outline: Vec2[]; centroid: Vec2; angle: number } {
  const angle = Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x);
  const centroid = polygonCentroid(v);
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const outline = v.map(p => {
    const dx = p.x - centroid.x, dy = p.y - centroid.y;
    return { x: c * dx - s * dy, y: s * dx + c * dy };
  });
  return { outline, centroid, angle };
}

function polygonCentroid(v: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    const w = p.x * q.y - q.x * p.y;
    a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function bounds(v: Vec2[]) {
  return {
    minX: Math.min(...v.map(p => p.x)), maxX: Math.max(...v.map(p => p.x)),
    minY: Math.min(...v.map(p => p.y)), maxY: Math.max(...v.map(p => p.y)),
  };
}

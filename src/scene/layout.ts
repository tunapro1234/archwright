// Where everything sits on the board, in metres. Pure maths (no three.js) so it is unit-tested.
//
// Site frame: origin at the centre of the board's top face, x to the player's right, y up,
// +z towards the player. The arch stands in the x-y plane at z = 0; its own frame ("arch frame",
// the solver's frame) is the site frame lifted by ABUTMENT_HEIGHT, so springings sit on the
// abutments. The tray holds the loose stones in rows in front of the arch, lying face up so their
// wedge shape reads from above; the centering slides out towards +z, stopping short of the tray.
import { ringArch, type Vec2 } from '../statics/index.js';
import { buildArch, createLevel, isClosed, placeStone, type GameState, type LevelDef, type StoneDef } from '../game/arch-state.js';

/** The centering a stone is shaped for (a level's geometry without its loads). */
type Shape = Pick<GameState['geometry'], 'span' | 'rise' | 'units' | 'depth'>;

export const ABUTMENT_HEIGHT = 0.05;
export const ABUTMENT_SPARE = 0.025;  // abutment width beyond the thickest stone
export const BOARD = { width: 0.46, zMin: -0.08, zMax: 0.3, thickness: 0.012 };
// TRAY.z: far edge (towards the arch) of the first row; rowGap: clear space between rows;
// gap: between two stones of a kind; groupGap: between kinds.
export const TRAY = { z: 0.15, rowGap: 0.015, maxWidth: 0.42, gap: 0.012, groupGap: 0.03 };
const MATERIAL_ORDER = ['sandstone', 'tuff', 'basalt'] as const;
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
 * slot it can take: stones of one kind are congruent anywhere on either half, even on a pointed
 * centering. Only a keystone differs there, since it straddles the point, so it is drawn for the crown.
 */
export function stoneOutline(geo: Shape, stone: StoneDef): Vec2[] {
  return toLocal(blockAt(geo, stone, stone.keystone ? crownSlot(geo, stone) : 0)).outline;
}

/** Geometry batches: stones with one key share one outline (colour comes per instance). */
export function shapeKey(s: StoneDef): string {
  return `${s.t}|${s.units}|${s.keystone ? 'k' : ''}`;
}

/** Pose of `stone` seated at course `slot`, in the site frame. */
export function slotPose(geo: Shape, stone: StoneDef, slot: number): Pose2 {
  const { centroid, angle } = toLocal(blockAt(geo, stone, slot));
  return { x: centroid.x, y: centroid.y + ABUTMENT_HEIGHT, z: 0, angle, tilt: 0 };
}

/** Middle of a stone's back (extrados) in its own frame: where a load stands on it (world 3). */
export function stoneBack(geo: Shape, stone: StoneDef): Vec2 {
  const o = stoneOutline(geo, stone); // [inner0, inner1, outer1, outer0]
  return { x: (o[2].x + o[3].x) / 2, y: (o[2].y + o[3].y) / 2 };
}

/** Where a load waits on the board until its course is covered: behind the arch, below its course. */
export function loadRest(geo: Shape, course: number): { x: number; y: number; z: number } {
  const unit: StoneDef = { id: '', material: 'tuff', t: 0.01, units: 1 };
  return { x: slotPose(geo, unit, course).x, y: 0, z: -(geo.depth / 2 + 0.025) };
}

/** Pose for a stone joining `side` of the arch right now. */
export function facePose(s: GameState, stone: StoneDef, side: 'left' | 'right'): Pose2 {
  const slot = side === 'left' ? s.left : s.geometry.units - s.right - stone.units;
  return slotPose(s.geometry, stone, slot);
}

/** Tray grouping key: stones of one material and shape are interchangeable, so they lie together. */
export function stoneKind(s: StoneDef): string {
  return `${s.material}|${s.t}|${s.units}|${s.keystone ? 'k' : ''}`;
}

/**
 * Tray positions, in tray order: rows of stones lying face up, centred across the board, grouped
 * by kind (material first, then shape) with a wider gap between kinds. A lying stone's local y
 * (out of the ring) points away from the player, so it lies as it will stand.
 */
export function trayPoses(def: LevelDef): Pose2[] {
  const geo = { span: def.span, rise: def.rise, units: def.stones, depth: def.depth };
  const boxes = def.tray.map(s => bounds(stoneOutline(geo, s)));
  // Kinds in order of first appearance within each material; stable inside a kind.
  const kinds: string[] = [];
  for (const s of def.tray) if (!kinds.includes(stoneKind(s))) kinds.push(stoneKind(s));
  const rank = (s: StoneDef) => MATERIAL_ORDER.indexOf(s.material) * 1000 + kinds.indexOf(stoneKind(s));
  const order = def.tray.map((_, i) => i).sort((a, b) => rank(def.tray[a]) - rank(def.tray[b]) || a - b);
  const gapBefore = (k: number) => (stoneKind(def.tray[order[k]]) === stoneKind(def.tray[order[k - 1]]) ? TRAY.gap : TRAY.groupGap);

  const rows: { i: number; gap: number }[][] = [[]];
  let width = 0;
  order.forEach((i, k) => {
    const w = boxes[i].maxX - boxes[i].minX;
    let row = rows[rows.length - 1];
    const gap = row.length ? gapBefore(k) : 0;
    if (row.length && width + gap + w > TRAY.maxWidth) { row = []; rows.push(row); width = 0; }
    const g = row.length ? gap : 0;
    width += g + w;
    row.push({ i, gap: g });
  });
  const out: Pose2[] = new Array(def.tray.length);
  let z0 = TRAY.z;
  for (const row of rows) {
    const total = row.reduce((a, { i, gap }) => a + gap + boxes[i].maxX - boxes[i].minX, 0);
    const rowDepth = Math.max(...row.map(({ i }) => boxes[i].maxY - boxes[i].minY));
    let x = -total / 2;
    for (const { i, gap } of row) {
      const b = boxes[i];
      x += gap;
      // Lying, local y maps to -z: the stone covers z in [pose.z - maxY, pose.z - minY].
      out[i] = { x: x - b.minX, y: def.depth / 2, z: z0 + rowDepth / 2 + (b.maxY + b.minY) / 2, angle: 0, tilt: LYING };
      x += b.maxX - b.minX;
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

/**
 * The centering's top as built: the intrados curve, except under the crown course, where the
 * keystone's flat underside lies. On a pointed centering the curve's point would stick through it.
 */
export function centeringTop(geo: Shape, segments: number): Vec2[] {
  const curve = intrados(geo.span, geo.rise, segments);
  if (geo.units % 2 === 0) return curve;
  const edge = intrados(geo.span, geo.rise, geo.units)[(geo.units - 1) / 2]; // left corner of the crown course
  const ex = Math.abs(edge.x);
  return [
    ...curve.filter(p => p.x < -ex - 1e-9),
    { x: -ex, y: edge.y }, { x: ex, y: edge.y },
    ...curve.filter(p => p.x > ex + 1e-9),
  ];
}

/**
 * Where the passenger walks once the arch holds (site frame, x-y at z = 0): over the left
 * abutment, along the back of every stone, and off over the right abutment.
 */
export function passengerPath(def: LevelDef, s: GameState): Vec2[] {
  const [l, r] = abutments(def);
  const path: Vec2[] = [{ x: l.x - l.width / 2, y: l.height }];
  for (const b of buildArch(s).blocks) {
    const [, , outer1, outer0] = b.vertices;
    path.push({ x: outer0.x, y: outer0.y + ABUTMENT_HEIGHT }, { x: outer1.x, y: outer1.y + ABUTMENT_HEIGHT });
  }
  path.push({ x: r.x + r.width / 2, y: r.height });
  return path;
}

/** The point a fraction `t` in [0, 1] of the way along a polyline, by length. */
export function along(path: Vec2[], t: number, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= len || i === path.length - 1) {
      const k = len > 0 ? Math.min(1, d / len) : 0;
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
      return out;
    }
    d -= len;
  }
  out.x = path[0].x; out.y = path[0].y;
  return out;
}

/**
 * The world a level's marker column belongs to: its id prefix ('w1'), and for a monument level
 * ('m-…') the world it closes, the one before it in `ids`.
 */
export function markerWorld(ids: string[], i: number): string {
  for (let j = i; j >= 0; j--) if (!ids[j].startsWith('m-')) return ids[j].split('-')[0];
  return ids[i].split('-')[0];
}

/**
 * Level markers: small stones in a column beside the board, one column per world (w1 left, w2
 * right, ...). A monument level's marker ends the column of the world it closes.
 */
export const MARKER = { size: 0.02, gap: 0.05, edge: 0.03, column: 0.045, z0: -0.02 };
export function markerSpots(ids: string[]): { id: string; x: number; z: number }[] {
  const worlds: string[] = [];
  const row = new Map<string, number>();
  return ids.map((id, i) => {
    const w = markerWorld(ids, i);
    if (!worlds.includes(w)) worlds.push(w);
    const k = worlds.indexOf(w);
    const n = row.get(w) ?? 0;
    row.set(w, n + 1);
    const side = k % 2 === 0 ? -1 : 1;
    const x = side * (BOARD.width / 2 + MARKER.edge + Math.floor(k / 2) * MARKER.column);
    return { id, x, z: MARKER.z0 + n * MARKER.gap };
  });
}

/** Marker of Today's Span: a round stone in the next free marker column, level with the first row. */
export function dailySpot(ids: string[]): { x: number; z: number } {
  const k = new Set(ids.map((_, i) => markerWorld(ids, i))).size;
  const side = k % 2 === 0 ? -1 : 1;
  return { x: side * (BOARD.width / 2 + MARKER.edge + Math.floor(k / 2) * MARKER.column), z: MARKER.z0 };
}

/**
 * The share tablet of Today's Span (site frame): a small slab standing on the board between the
 * arch and the tray, right of centre, leaning back towards the arch. Its face shows one tile per stone.
 */
export const TABLET = { x: 0.13, z: 0.095, width: 0.085, height: 0.045, thickness: 0.009, lean: 0.35, tile: 0.0064, tileGap: 0.0017 };

/**
 * The accessibility panel (site frame): a small stone slab off the board's front left corner, past
 * the marker columns, lying with its top tilted towards the player. Three icons in a row along x,
 * no text: gaze (an eye), one hand (a hand), high contrast (a half-filled disc).
 */
export const A11Y_PANEL = { x: -0.285, z: 0.27, width: 0.072, depth: 0.03, height: 0.01, lean: 0.3, icon: 0.0075, pitch: 0.023 };
export const A11Y_ICONS = ['gaze', 'oneHand', 'highContrast'] as const;

/** Centre of icon `i` (A11Y_ICONS order), in the frame of the panel's sloped top face. */
export function a11yIconSpot(i: number): { x: number; y: number; z: number } {
  return { x: (i - 1) * A11Y_PANEL.pitch, y: 0, z: 0 };
}

/**
 * A monument level's plaque (src/levels/monuments.ts): a low stone slab on the desk just in front of
 * the board's front edge, centred, its top sloping up away from the player so it faces them.
 */
export const PLAQUE = { x: 0, z: BOARD.zMax + 0.032, width: 0.17, depth: 0.036, height: 0.008, lean: 0.35 };

/** The rebuild stone a collapsed arch offers (site frame): above the board, in front of the arch. */
export const REBUILD = { x: 0, y: 0.1, z: 0.09 } as const;

/** Pull distance at which the centering clears the stones and the arch is struck. */
export const strikePull = (depth: number): number => depth + CENTERING.strikeExtra;

/**
 * The abutments as cut stone: two courses of ashlar blocks with staggered joints. The lower course
 * is two blocks side by side, the upper one a single cap split front and back, so no vertical joint
 * runs straight through. Boxes in the site frame (centre, size); the chamfer on each block is the joint.
 */
export function ashlarBlocks(a: { x: number; width: number; height: number }, depth: number): { x: number; y: number; z: number; w: number; h: number; d: number }[] {
  const low = a.height * 0.55, cap = a.height - low;
  return [
    ...[-1, 1].map(k => ({ x: a.x + (k * a.width) / 4, y: low / 2, z: 0, w: a.width / 2, h: low, d: depth })),
    ...[-1, 1].map(k => ({ x: a.x, y: low + cap / 2, z: (k * depth) / 4, w: a.width, h: cap, d: depth / 2 })),
  ];
}

/** Every stone of the level's reference arch as built, with its outline in the site frame ([inner0, inner1, outer1, outer0]). */
function builtStones(def: LevelDef): { slot: number; units: number; outline: Vec2[] }[] {
  let s = createLevel(def);
  for (const step of def.solution) if (!s.error) s = placeStone(s, step.stone, step.side);
  if (s.error || !isClosed(s)) return [];
  return s.placed.map(p => {
    const pose = slotPose(s.geometry, p.stone, p.slot);
    const c = Math.cos(pose.angle), n = Math.sin(pose.angle);
    const outline = stoneOutline(s.geometry, p.stone).map(v => ({ x: pose.x + c * v.x - n * v.y, y: pose.y + n * v.x + c * v.y }));
    return { slot: p.slot, units: p.stone.units, outline };
  });
}
const builtArch = (def: LevelDef): Vec2[][] => builtStones(def).map(b => b.outline);

/** The crown: where the arch's back (extrados) crosses its middle (x = 0), in the site frame. */
export function crownPoint(def: LevelDef): { x: number; y: number; z: number } {
  let y = -Infinity;
  for (const o of builtArch(def)) {
    const a = o[3], b = o[2];
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    if (lo > 1e-9 || hi < -1e-9) continue;
    y = Math.max(y, hi - lo < 1e-12 ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x));
  }
  return { x: 0, y: Number.isFinite(y) ? y : ABUTMENT_HEIGHT + def.rise, z: 0 };
}

/** Middle of an abutment's top face, in the site frame. */
export function abutmentTop(def: LevelDef, side: 'left' | 'right'): { x: number; y: number; z: number } {
  const a = abutments(def)[side === 'left' ? 0 : 1];
  return { x: a.x, y: a.height, z: 0 };
}

/** Highest a load model stands above the stone it rides on (the tallest, a tower at its largest). */
const LOAD_TOP = 0.065;

/**
 * Points (site frame) the desktop camera keeps in view for a level: the board, the marker columns
 * beside it and the accessibility panel, the arch as built with its abutments and any loads riding
 * on it, every tray stone, and the centering's handle over its whole travel.
 */
export function viewPoints(def: LevelDef, ids: string[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  const geo = createLevel(def).geometry;
  for (const x of [-BOARD.width / 2, BOARD.width / 2]) for (const z of [BOARD.zMin, BOARD.zMax]) out.push({ x, y: 0, z });
  for (const m of [...markerSpots(ids), dailySpot(ids)]) {
    for (const k of [-1, 1]) out.push({ x: m.x + (k * MARKER.size) / 2, y: MARKER.size, z: m.z + (k * MARKER.size) / 2 });
  }
  for (const k of [-1, 1]) out.push({ x: A11Y_PANEL.x + (k * A11Y_PANEL.width) / 2, y: A11Y_PANEL.height + A11Y_PANEL.depth * 0.3, z: A11Y_PANEL.z + A11Y_PANEL.depth / 2 });
  const built = builtStones(def);
  for (const p of built.flatMap(b => b.outline)) for (const z of [-def.depth / 2, def.depth / 2]) out.push({ x: p.x, y: p.y, z });
  for (const a of abutments(def)) {
    for (const k of [-1, 1]) out.push({ x: a.x + (k * a.width) / 2, y: a.height, z: def.depth / 2 + 0.006 });
  }
  for (const l of geo.loads) {
    // Waiting behind the arch on the board, then riding on the middle of its stone's back.
    out.push({ ...loadRest(geo, l.course), y: LOAD_TOP });
    const on = built.find(b => b.slot <= l.course && l.course < b.slot + b.units);
    if (on) for (const v of [on.outline[2], on.outline[3]]) out.push({ x: v.x, y: v.y + LOAD_TOP, z: 0 });
  }
  trayPoses(def).forEach((p, i) => {
    const o = stoneOutline(geo, def.tray[i]);
    for (const v of o) out.push({ x: p.x + v.x, y: def.depth, z: p.z - v.y });
  });
  if (def.id.startsWith('m-')) { // the plaque of a monument level
    for (const k of [-1, 1]) out.push({ x: PLAQUE.x + (k * PLAQUE.width) / 2, y: PLAQUE.height, z: PLAQUE.z + PLAQUE.depth / 2 });
  }
  const handle = { y: 0.022, z: def.depth * 0.46 + CENTERING.handleDepth };
  for (const pull of [0, CENTERING.maxPull]) out.push({ x: 0, y: handle.y, z: handle.z + pull });
  return out;
}

/** Something a hand reaches for, by kind. */
export type ReachKind = 'tray stone' | 'open end' | 'centering handle' | 'rebuild stone' | 'level marker' | 'share tablet' | 'panel icon';

/**
 * Every point (site frame) a player's hand goes to in a level: the centre of each tray stone, of each open end as the
 * reference solution fills them, of the centering's handle at rest and fully pulled, of the rebuild stone, of each
 * level marker (Today's Span's too), of the share tablet's face and of the accessibility panel's icons.
 */
export function reachPoints(def: LevelDef, ids: string[]): { kind: ReachKind; x: number; y: number; z: number }[] {
  const out: { kind: ReachKind; x: number; y: number; z: number }[] = [];
  for (const p of trayPoses(def)) out.push({ kind: 'tray stone', x: p.x, y: p.y, z: p.z });
  let s = createLevel(def);
  for (const step of def.solution) {
    const stone = def.tray.find(t => t.id === step.stone)!;
    const p = facePose(s, stone, step.side);
    out.push({ kind: 'open end', x: p.x, y: p.y, z: p.z });
    s = placeStone(s, step.stone, step.side);
  }
  const handle = { y: 0.022, z: def.depth * 0.46 + CENTERING.handleDepth / 2 };
  for (const pull of [0, CENTERING.maxPull]) out.push({ kind: 'centering handle', x: 0, y: handle.y, z: handle.z + pull });
  out.push({ kind: 'rebuild stone', ...REBUILD });
  for (const m of [...markerSpots(ids), dailySpot(ids)]) out.push({ kind: 'level marker', x: m.x, y: MARKER.size / 2, z: m.z });
  out.push({ kind: 'share tablet', x: TABLET.x, y: TABLET.height / 2, z: TABLET.z });
  const top = A11Y_PANEL.height + (A11Y_PANEL.depth * Math.tan(A11Y_PANEL.lean)) / 2;
  A11Y_ICONS.forEach((_, i) => out.push({ kind: 'panel icon', x: A11Y_PANEL.x + a11yIconSpot(i).x, y: top, z: A11Y_PANEL.z }));
  return out;
}

// --- helpers ---------------------------------------------------------------------------------

// A keystone fills the gap the two halves leave, and neither half may pass the crown: with one
// course to fill that gap is the middle one (wider keystones are taken as centred too).
const crownSlot = (geo: Shape, stone: StoneDef) => Math.floor((geo.units - stone.units) / 2);

function blockAt(geo: Shape, stone: StoneDef, slot: number): Vec2[] {
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

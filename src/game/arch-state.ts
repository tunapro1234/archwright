// Game state of one level: pure data and pure functions, no three.js. Every call returns a new state.
//
// The wooden centering fixes the intrados and divides it into equal courses. Stones snap onto the
// two open faces only: the left half grows from the left abutment, the right half from the right,
// and neither half may cross the crown. The last gap takes a keystone, which closes the arch.
// The player's only choice is which stone goes on which side; the stones differ in thickness,
// weight and width, so that choice decides whether the arch holds when the centering is struck.
import { ringArch, solveArch, type Arch, type PointLoad, type SolveResult } from '../statics/index.js';

export type Side = 'left' | 'right';
export type Step = { stone: string; side: Side };

export type Material = 'sandstone' | 'tuff' | 'basalt';
/**
 * Densities in kg/m^3: round values inside the usual range for each stone (sandstone about
 * 2000-2600, volcanic tuff roughly 1200-2000, basalt about 2700-3000). Game values, not survey data.
 */
export const MATERIAL_DENSITY: Record<Material, number> = { sandstone: 2300, tuff: 1500, basalt: 2900 };

export interface StoneDef {
  id: string;
  material: Material;
  t: number;          // radial thickness, m
  units: number;      // courses of the centering it covers (1 = normal wedge, 2 = wide wedge)
  keystone?: boolean; // only a keystone can close the last gap, and it must fill it exactly
}

/**
 * A weight that stands on the finished arch (world 3): a small tower, a bell or a cart. It rests on
 * the extrados of whichever stone covers its course of the centering (0 = the course by the left
 * abutment) and reaches the solver as a vertical point load of kg * g there.
 */
export type LoadKind = 'tower' | 'bell' | 'cart';
export interface Load { course: number; kg: number; kind: LoadKind }

export const G = 9.81;

export interface LevelDef {
  id: string;
  span: number;       // centering (intrados) span, m
  rise: number;       // centering rise, m; span/2 is a semicircle
  stones: number;     // courses the centering is divided into (an odd number keeps the keystone at the crown)
  depth: number;      // stone depth across the arch, m
  tray: StoneDef[];
  solution: Step[];   // a full arrangement that the solver says holds
  trap: Step[];       // a full arrangement that closes the arch but collapses
  par: number;        // fewest stones a known holding arrangement uses
  friction?: number;  // joint friction coefficient (solver default 0.7)
  loads?: Load[];     // weights on the arch (world 3); none by default
}

export interface PlacedStone { stone: StoneDef; side: Side; slot: number } // slot = first course it covers

export type Phase = 'building' | 'ready' | 'held' | 'collapsed';

export interface GameState {
  level: string;
  phase: Phase;              // building -> ready (closed) -> held | collapsed
  geometry: { span: number; rise: number; units: number; depth: number; friction?: number; loads: Load[] };
  stones: StoneDef[];        // every stone of the level, in tray order
  tray: StoneDef[];          // stones not placed yet, in tray order
  placed: PlacedStone[];     // in placement order
  left: number;              // courses filled from the left abutment
  right: number;             // courses filled from the right abutment
  result?: SolveResult;      // set by strike
  error?: string;            // set when the last action was refused; the rest of the state is unchanged
}

export function createLevel(def: LevelDef): GameState {
  return {
    level: def.id,
    phase: 'building',
    geometry: {
      span: def.span, rise: def.rise, units: def.stones, depth: def.depth, friction: def.friction,
      loads: (def.loads ?? []).map(l => ({ ...l })),
    },
    stones: def.tray,
    tray: def.tray.slice(),
    placed: [],
    left: 0,
    right: 0,
  };
}

const gap = (s: GameState): number => s.geometry.units - s.left - s.right;
const refuse = (s: GameState, error: string): GameState => ({ ...s, error });

export function isClosed(s: GameState): boolean {
  return gap(s) === 0;
}

/** The faces a stone can snap to: both growing ends until the keystone is in, then none. */
export function openFaces(s: GameState): { side: Side; slot: number }[] {
  if (isClosed(s) || s.phase !== 'building') return [];
  return [
    { side: 'left', slot: s.left },
    { side: 'right', slot: s.geometry.units - 1 - s.right },
  ];
}

/** Why `stone` cannot go on `side` right now, or undefined if it can. */
export function whyNot(s: GameState, stone: StoneDef, side: Side): string | undefined {
  if (s.phase !== 'building') return 'the arch is ' + s.phase;
  const g = gap(s);
  if (stone.keystone) return stone.units === g ? undefined : `the keystone fills a gap of ${stone.units}, the gap is ${g}`;
  if (stone.units >= g) return 'the last gap takes a keystone';
  const half = s.geometry.units / 2;
  if ((side === 'left' ? s.left : s.right) + stone.units > half) return 'a half cannot grow past the crown';
  return undefined;
}

export function placeStone(s: GameState, stoneId: string, side: Side): GameState {
  if (side !== 'left' && side !== 'right') return refuse(s, `unknown side ${String(side)}`);
  const i = s.tray.findIndex(t => t.id === stoneId);
  if (i < 0) return refuse(s, `stone ${stoneId} is not in the tray`);
  const stone = s.tray[i];
  const no = whyNot(s, stone, side);
  if (no) return refuse(s, no);
  const slot = side === 'left' ? s.left : s.geometry.units - s.right - stone.units;
  const next: GameState = {
    ...s,
    tray: s.tray.filter((_, k) => k !== i),
    placed: [...s.placed, { stone, side, slot }],
    left: side === 'left' ? s.left + stone.units : s.left,
    right: side === 'right' ? s.right + stone.units : s.right,
    error: undefined,
  };
  if (isClosed(next)) next.phase = 'ready';
  return next;
}

/** Lift the outermost stone off one side and return it to the tray (the keystone counts on the side it went in). */
export function takeBack(s: GameState, side: Side): GameState {
  if (s.phase !== 'building' && s.phase !== 'ready') return refuse(s, 'the arch is ' + s.phase);
  const k = s.placed.map(p => p.side).lastIndexOf(side);
  if (k < 0) return refuse(s, `nothing to take back on the ${side}`);
  const p = s.placed[k];
  const back = new Set([...s.tray.map(t => t.id), p.stone.id]);
  return {
    ...s,
    phase: 'building',
    tray: s.stones.filter(t => back.has(t.id)),
    placed: s.placed.filter((_, j) => j !== k),
    left: side === 'left' ? s.left - p.stone.units : s.left,
    right: side === 'right' ? s.right - p.stone.units : s.right,
    error: undefined,
  };
}

/** Placed stones from the left springing to the right one. */
export function ringOrder(s: GameState): PlacedStone[] {
  return [...s.placed].sort((a, b) => a.slot - b.slot);
}

/** The arch the solver sees: block i is ringOrder(s)[i]. Only defined once the arch is closed. */
export function buildArch(s: GameState): Arch {
  if (!isClosed(s)) throw new Error('buildArch: the arch is not closed');
  const g = s.geometry;
  return ringArch({
    span: g.span,
    rise: g.rise,
    units: g.units,
    depth: g.depth,
    pieces: ringOrder(s).map(p => ({ units: p.stone.units, t: p.stone.t, density: MATERIAL_DENSITY[p.stone.material] })),
  });
}

/** The stone covering course `course`, or undefined while that course is still open. */
export function stoneAt(s: GameState, course: number): PlacedStone | undefined {
  return s.placed.find(p => p.slot <= course && course < p.slot + p.stone.units);
}

/**
 * The loads as the solver takes them, for a closed arch: each at the middle of the extrados of the
 * stone that covers its course (block i of buildArch is ringOrder(s)[i]). A load over an open course
 * has nothing to stand on and is left out.
 */
export function pointLoads(s: GameState, arch: Arch = buildArch(s)): PointLoad[] {
  const ring = ringOrder(s);
  const out: PointLoad[] = [];
  for (const l of s.geometry.loads) {
    const p = stoneAt(s, l.course);
    if (!p) continue;
    const v = arch.blocks[ring.indexOf(p)].vertices; // [intrados k, intrados k1, extrados k1, extrados k]
    out.push({ at: { x: (v[2].x + v[3].x) / 2, y: (v[2].y + v[3].y) / 2 }, fy: -l.kg * G });
  }
  return out;
}

/**
 * Pull the centering. A closed arch is judged by the statics solver. An open one has no path for
 * the thrust from one abutment to the other, so it cannot carry itself as an arch: it is reported
 * as collapsed (no thrust line, no joints to name; which loose stones stay put is left to the physics).
 */
export function strike(s: GameState): { state: GameState; result: SolveResult } {
  if (s.result && (s.phase === 'held' || s.phase === 'collapsed')) return { state: s, result: s.result };
  let result: SolveResult;
  if (!isClosed(s)) {
    result = { stands: false, thrustLine: [], minMargin: -1, criticalJoints: [], failure: 'hinge' };
  } else {
    const arch = buildArch(s);
    const loads = pointLoads(s, arch);
    result = solveArch(arch, {
      ...(s.geometry.friction === undefined ? {} : { friction: s.geometry.friction }),
      ...(loads.length ? { pointLoads: loads } : {}),
    });
  }
  const state: GameState = { ...s, phase: result.stands ? 'held' : 'collapsed', result, error: undefined };
  return { state, result };
}


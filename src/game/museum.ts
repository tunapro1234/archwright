// The desk museum: every world the player has finished earns a plinth behind the board, with a
// small copy of that world's last arch on it. Pure functions over plain data (no three.js, no
// WebXR): which plinths there are, where they stand, what stands on them, and the saved anchor
// handles that keep them in the same place in the room from one XR session to the next. Nothing
// here throws: a corrupt progress or save reads as an empty museum.
import { LEVELS } from '../levels/index.js';
import { createLevel, isClosed, placeStone, type LevelDef, type Step, type StoneDef } from './arch-state.js';
import { decodeArch, type Progress, type ProgressStorage } from './progress.js';
import { ABUTMENT_HEIGHT, abutments, BOARD, slotPose, type Pose2 } from '../scene/layout.js';

export const MUSEUM_KEY = 'archwright.museum.v1';
export const MAX_PLINTHS = 8;
/** A plinth: a square stone block, `size` across and `height` tall. */
export const PLINTH = { size: 0.07, height: 0.03 };
/** Plinth rows: behind the board's far edge, from the back corners outwards, left and right in turn. */
const ROW = { behind: 0.07, x0: 0.19, pitch: 0.1 };
/** Widest a copy may be (with its piers) on a plinth. */
const COPY_WIDTH = 0.062;

export interface Piece {
  id: string;      // 'world:w1'
  levelId: string; // the world's last level, whose arch stands on the plinth
  stones: number;  // the player's best stone count on that level
  slot: number;    // 0.. in world order
  arch?: string;   // the player's arrangement on that level (progress encodeArch), when the save has it
}

/** Worlds in LEVELS order, each with its level ids. */
function worlds(): { world: string; ids: string[] }[] {
  const out: { world: string; ids: string[] }[] = [];
  for (const l of LEVELS) {
    const w = l.id.split('-')[0];
    if (!/^w\d+$/.test(w)) continue;
    let e = out.find(o => o.world === w);
    if (!e) out.push((e = { world: w, ids: [] }));
    e.ids.push(l.id);
  }
  return out;
}

/** A plinth for each world whose every level is solved, in world order (not the order they were finished). */
export function museumPieces(p: Progress): Piece[] {
  const solved = p && typeof p.solved === 'object' && p.solved ? p.solved : {};
  const out: Piece[] = [];
  for (const { world, ids } of worlds()) {
    if (out.length >= MAX_PLINTHS) break;
    if (!ids.every(id => solved[id])) continue;
    const levelId = ids[ids.length - 1];
    const { stones, arch } = solved[levelId];
    out.push({ id: `world:${world}`, levelId, stones, slot: out.length, ...(typeof arch === 'string' && arch ? { arch } : {}) });
  }
  return out;
}

/**
 * Where plinths 0..n-1 stand on the site frame's x-z plane: one row 7 cm behind the board's far
 * edge, beside and beyond the arch, alternating left and right from the back corners outwards
 * 10 cm apart. Plinth i is always in the same place, so a new plinth never moves the others.
 */
export function plinthLayout(n: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < Math.min(n, MAX_PLINTHS); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    out.push({ x: side * (ROW.x0 + Math.floor(i / 2) * ROW.pitch), z: BOARD.zMin - ROW.behind });
  }
  return out;
}

/**
 * The copy on a plinth: the player's own arrangement (`arch`, from the save) or, when the save has
 * none or it does not build a closed arch on this level, the level's reference solution; its two
 * piers, and the scale that fits it on the plinth. Poses are in the arch's site frame with the
 * board at y = 0; scale them and stand them on the plinth top. `own` says whose arch it is.
 */
export function miniature(def: LevelDef, arch?: string): {
  own: boolean;
  scale: number;
  stones: { stone: StoneDef; pose: Pose2 }[];
  piers: { x: number; width: number; height: number }[];
} {
  const build = (steps: Step[]) => {
    let s = createLevel(def);
    for (const step of steps) if (!s.error) s = placeStone(s, step.stone, step.side);
    return s.error || !isClosed(s) ? null : s;
  };
  const played = arch === undefined ? null : decodeArch(def.id, arch);
  const mine = played && build(played);
  const s = mine ?? build(def.solution)!;
  const piers = abutments(def);
  const width = 2 * (Math.abs(piers[0].x) + piers[0].width / 2);
  return {
    own: !!mine,
    scale: COPY_WIDTH / width,
    stones: s.placed.map(p => ({ stone: p.stone, pose: slotPose(s.geometry, p.stone, p.slot) })),
    piers: piers.map(a => ({ ...a, height: ABUTMENT_HEIGHT })),
  };
}

/** Persistent anchor handles by piece id (WebXR anchors, saved under MUSEUM_KEY). */
export type AnchorHandles = Record<string, string>;

export function loadHandles(storage: ProgressStorage | null): AnchorHandles {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(MUSEUM_KEY) ?? '{}');
    const h = (raw as { handles?: unknown } | null)?.handles;
    if (!h || typeof h !== 'object' || Array.isArray(h)) return {};
    const out: AnchorHandles = {};
    for (const [k, v] of Object.entries(h)) if (/^world:w\d+$/.test(k) && typeof v === 'string' && v) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function saveHandles(storage: ProgressStorage | null, handles: AnchorHandles): boolean {
  if (!storage) return false;
  try {
    storage.setItem(MUSEUM_KEY, JSON.stringify({ handles }));
    return true;
  } catch {
    return false;
  }
}

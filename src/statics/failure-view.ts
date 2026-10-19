// Why a struck arch falls, as something to draw (src/systems/statics.ts): the solver's least-bad line of thrust,
// the joints it leaves (a hinge opens at the joint's edge there) and the joints the solver names critical; and what
// the same level, built again, still marks of that collapse: small rings where it broke.
// Pure, no three.js: the same result and arch always give the same marks.
import type { Arch, SolveResult, Vec2 } from './index.js';

export type FailureKind = 'none' | 'hinge' | 'sliding' | 'tension';
export interface FailureMarks {
  kind: FailureKind;
  /** The line of thrust to draw, one point per joint (n+1); null when it holds or when a joint would have to pull. */
  line: Vec2[] | null;
  /** Joints the line passes outside of (|eccentricity| reaches the half joint length): the masonry cannot carry it there. */
  outside: number[];
  /** The solver's critical joints: where the arch breaks. */
  joints: number[];
}

const EDGE_TOL = 1e-6;

/** Eccentricity of `p` along joint `j` (signed distance from the joint's midpoint, towards its second point) and its half length. */
export function jointOffset(arch: Arch, j: number, p: Vec2): { e: number; h: number } {
  const [a, b] = arch.joints[j];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  return { e: (p.x - (a.x + b.x) / 2) * ux + (p.y - (a.y + b.y) / 2) * uy, h: len / 2 };
}

/** The marks for a strike's result on its arch. A standing arch has none. */
export function failureMarks(result: SolveResult, arch: Arch): FailureMarks {
  if (result.stands) return { kind: 'none', line: null, outside: [], joints: [] };
  const kind = result.failure ?? 'hinge';
  const joints = [...result.criticalJoints];
  const line = kind !== 'tension' && result.thrustLine.length === arch.joints.length ? result.thrustLine.map(p => ({ ...p })) : null;
  const outside: number[] = [];
  if (line) {
    line.forEach((p, j) => {
      const { e, h } = jointOffset(arch, j, p);
      if (Math.abs(e) >= h - EDGE_TOL) outside.push(j);
    });
  }
  // A hinge means the line has to leave the masonry somewhere; should rounding hide it, name the solver's worst joint.
  if (kind === 'hinge' && line && outside.length === 0) {
    let worst = 0, most = -Infinity;
    line.forEach((p, j) => {
      const { e, h } = jointOffset(arch, j, p);
      if (Math.abs(e) / h > most) { most = Math.abs(e) / h; worst = j; }
    });
    outside.push(worst);
  }
  return { kind, line, outside, joints };
}

/** Whether `p` lies in a block of the arch (on its edge counts as in). */
export function inMasonry(arch: Arch, p: Vec2, tol = 1e-9): boolean {
  return arch.blocks.some(b => {
    const v = b.vertices;
    let pos = false, neg = false;
    for (let i = 0; i < v.length; i++) {
      const a = v[i], c = v[(i + 1) % v.length];
      const cr = (c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x);
      if (cr > tol) pos = true; else if (cr < -tol) neg = true;
      if (pos && neg) return false;
    }
    return true;
  });
}

/** Where the line leaves the stone at an outside joint: the joint's end on the line's side (the hinge's edge). */
export function hingeEdge(arch: Arch, j: number, p: Vec2): Vec2 {
  const [a, b] = arch.joints[j];
  return jointOffset(arch, j, p).e >= 0 ? { ...b } : { ...a };
}

/** One piece of the drawing: a polyline (arch frame, m) and the tube radius at each of its points. */
export interface Stroke { points: Vec2[]; radius: number[] }

/** Tube radii (m): the line inside the stones, the line where it has left them, a crack, a hinge ring. */
export const STROKE = { line: 0.0022, outside: 0.0045, crack: 0.0012, ring: 0.0014, ringRadius: 0.007 } as const;
/** The failed line is dashed (m along it): colour is never the only thing that tells it from a holding one. */
export const DASH = { on: 0.009, off: 0.005, step: 0.0015 } as const;
const CRACK_TEETH = 6;
const CRACK_AMP = 0.0025;
const RING_SIDES = 16;

/**
 * What to draw for these marks: the line of thrust dashed, thicker where it runs outside the stones; a thin zigzag
 * crack along each critical joint; a small ring where the line leaves the stone at each outside joint.
 */
export function failureStrokes(marks: FailureMarks, arch: Arch): Stroke[] {
  const out: Stroke[] = [];
  if (marks.line) out.push(...dashes(marks.line, arch));
  for (const j of marks.joints) {
    if (j < 0 || j >= arch.joints.length) continue;
    const pts = crackPath(arch, j);
    out.push({ points: pts, radius: pts.map(() => STROKE.crack) });
  }
  if (marks.line) for (const j of marks.outside) {
    const c = hingeEdge(arch, j, marks.line[j]);
    const pts = Array.from({ length: RING_SIDES + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / RING_SIDES;
      return { x: c.x + STROKE.ringRadius * Math.cos(a), y: c.y + STROKE.ringRadius * Math.sin(a) };
    });
    out.push({ points: pts, radius: pts.map(() => STROKE.ring) });
  }
  return out;
}

/** The polyline through the joint points cut into dashes, sampled every DASH.step, each sample thick when outside the masonry. */
function dashes(line: Vec2[], arch: Arch): Stroke[] {
  const out: Stroke[] = [];
  const period = DASH.on + DASH.off;
  let cur: Stroke = { points: [], radius: [] };
  const end = () => { if (cur.points.length > 1) out.push(cur); cur = { points: [], radius: [] }; };
  let s = 0; // arc length at the start of the current segment
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    const steps = Math.max(1, Math.ceil(len / DASH.step));
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const t = k / steps;
      if ((s + t * len) % period > DASH.on) { end(); continue; }
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      cur.points.push(p);
      cur.radius.push(inMasonry(arch, p, 1e-12) ? STROKE.line : STROKE.outside);
    }
    s += len;
  }
  end();
  return out;
}

/** A zigzag along joint j, from one end to the other, its teeth CRACK_AMP to either side. */
export function crackPath(arch: Arch, j: number): Vec2[] {
  const [a, b] = arch.joints[j];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  return Array.from({ length: CRACK_TEETH + 1 }, (_, i) => {
    const t = i / CRACK_TEETH, k = i === 0 || i === CRACK_TEETH ? 0 : (i % 2 ? 1 : -1) * CRACK_AMP;
    return { x: a.x + (b.x - a.x) * t + nx * k, y: a.y + (b.y - a.y) * t + ny * k };
  });
}

/**
 * A collapse remembered until its level is built again (src/game/runtime.ts): the level, the joints it broke at and
 * where those joints' middles were when it fell (arch frame, m). Which stone to change is not said; only where it broke.
 */
export interface FallMemory { level: string; joints: number[]; at: Vec2[] }

/** The joints a level load still marks from the last collapse: its joints when it fell on this very level, none otherwise. */
export function carryJoints(prev: { level: string; joints: readonly number[] } | null, def: { id: string }): number[] {
  return prev && prev.level === def.id ? [...prev.joints] : [];
}

/** The middle of joint j. */
export function jointMid(arch: Arch, j: number): Vec2 {
  const [a, b] = arch.joints[j];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** What a strike leaves to remember: the joints a closed arch broke at and their middles; null when it held or names none. */
export function rememberFall(level: string, marks: FailureMarks, arch: Arch | null): FallMemory | null {
  if (marks.kind === 'none' || !arch || !marks.joints.length) return null;
  return { level, joints: [...marks.joints], at: marks.joints.map(j => jointMid(arch, j)) };
}

/** A remembered joint's ring (m): centre-line radius and tube radius, under 14 mm across (2 · (radius + tube)). */
export const MEMORY_RING = { radius: 0.005, tube: 0.0012 } as const;

/** The remembered joints' rings' opacity: firm enough to read against the centering, unlike the fallen marks' FAIL_REST. */
export const MEMORY_RING_OPACITY = 0.7;

/** One small ring round each remembered joint middle. */
export function memoryStrokes(at: readonly Vec2[]): Stroke[] {
  return at.map(c => {
    const points = Array.from({ length: RING_SIDES + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / RING_SIDES;
      return { x: c.x + MEMORY_RING.radius * Math.cos(a), y: c.y + MEMORY_RING.radius * Math.sin(a) };
    });
    return { points, radius: points.map(() => MEMORY_RING.tube) };
  });
}

// Rigid-block limit analysis for masonry arches (Heyman, "The Stone Skeleton", 1995).
// Blocks are rigid, joints carry no tension, crushing never governs; a joint may slide only when
// friction is exceeded. The arch stands if *some* line of thrust in equilibrium with the loads
// stays inside every joint (safe theorem). Three numbers fix that line: the force the left
// abutment puts into block 0 (x and y) and its moment. Every joint condition is linear in them,
// so "does an admissible line exist" is a tiny 3-unknown LP, and the largest-margin line takes a
// few more of them (see maxMargin). With finite friction this is the usual lower-bound check;
// strictly, non-associative sliding can make it slightly optimistic (Gilbert et al. 2006).
import { lpMax } from './lp.js';

export { semicircularArch, pointedArch, ringArch } from './arches.js';
export type { PointedArchParams, RingArchParams, RingPiece } from './arches.js';

export type Vec2 = { x: number; y: number };             // metre, x yatay, y yukarı
export interface Block { vertices: Vec2[]; density?: number } // dışbükey çokgen, CCW; density kg/m^3 (vars. 2200)
export interface Arch {
  blocks: Block[];          // sırayla: blok i ile i+1 ortak bir kenarı (derz) paylaşır
  joints: [Vec2, Vec2][];   // n+1 derz: joints[0] sol mesnet yüzü, joints[n] sağ mesnet yüzü, joints[i] blok i-1 | blok i
  depth: number;            // düzlem dışı kalınlık (m)
}
export interface PointLoad { at: Vec2; fx?: number; fy: number } // Newton, yerçekimi yönü fy < 0
export interface SolveOptions { friction?: number; pointLoads?: PointLoad[]; g?: number } // vars. friction 0.7, g 9.81
export interface SolveResult {
  stands: boolean;
  thrustLine: Vec2[];       // derz başına bir nokta (n+1); stands=false ise en iyi deneme
  minMargin: number;        // min_i (yarı derz uzunluğu - |eksantrisite|) / yarı derz uzunluğu; stands=false ise <= 0
  criticalJoints: number[]; // menteşe oluşan / sınırda olan derzler (çöküş animasyonu bunları kullanır)
  failure?: 'hinge' | 'sliding' | 'tension';
}

const DEFAULT_DENSITY = 2200;
const BOX = 1e3;            // bound on the scaled unknowns (forces in units of total load)
const BISECT = 24;          // friction-factor resolution 2^-24 (sliding report only)
const CRITICAL_TOL = 1e-3;  // joints within this of the governing value are reported critical

/** Per-joint data in scaled coordinates: lengths / L, forces / W, moments / (W L). */
interface JointData {
  cx: number; cy: number;   // joint midpoint
  ux: number; uy: number;   // unit vector along the joint (first point -> second)
  nx: number; ny: number;   // unit normal pointing into block j (away from block j-1 on the last joint)
  h: number;                // half joint length
  // Force crossing the joint = (X, Y) + (lx, ly); its moment about the origin = Mo + mo,
  // where (X, Y, Mo) is the left abutment's force and moment.
  lx: number; ly: number; mo: number;
}

interface Problem { joints: JointData[]; L: number; W: number; ox: number; oy: number; order: Uint16Array }

function polygonProps(v: Vec2[]): { area: number; cx: number; cy: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < v.length; i++) {
    const p = v[i], q = v[(i + 1) % v.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
  }
  a /= 2;
  if (Math.abs(a) < 1e-15) throw new Error('solveArch: degenerate block');
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

function insideConvex(v: Vec2[], p: Vec2, tol: number): boolean {
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -tol) return false;
  }
  return true;
}

function prepare(arch: Arch, opts: SolveOptions): Problem {
  const n = arch.blocks.length;
  if (n < 1 || arch.joints.length !== n + 1) throw new Error('solveArch: need n blocks and n+1 joints');
  const g = opts.g ?? 9.81;

  // Reference frame: origin at the mean joint midpoint, length scale = largest distance from it.
  let ox = 0, oy = 0;
  for (const [a, b] of arch.joints) { ox += (a.x + b.x) / 2; oy += (a.y + b.y) / 2; }
  ox /= n + 1; oy /= n + 1;
  let L = 0;
  for (const [a, b] of arch.joints) L = Math.max(L, Math.hypot(a.x - ox, a.y - oy), Math.hypot(b.x - ox, b.y - oy));
  if (!(L > 0)) throw new Error('solveArch: degenerate geometry');

  // Loads per block: self-weight at the centroid plus point loads on the block that holds them.
  const props = arch.blocks.map(b => polygonProps(b.vertices));
  const fx = new Float64Array(n), fy = new Float64Array(n), mz = new Float64Array(n);
  let W = 0;
  for (let i = 0; i < n; i++) {
    const w = props[i].area * arch.depth * (arch.blocks[i].density ?? DEFAULT_DENSITY) * g;
    fy[i] -= w; mz[i] += props[i].cx * -w; W += w;
  }
  for (const pl of opts.pointLoads ?? []) {
    let k = arch.blocks.findIndex(b => insideConvex(b.vertices, pl.at, 1e-9 * L * L));
    if (k < 0) { // outside every block: hand it to the nearest centroid
      let best = Infinity;
      props.forEach((p, i) => { const d = Math.hypot(p.cx - pl.at.x, p.cy - pl.at.y); if (d < best) { best = d; k = i; } });
    }
    const px = pl.fx ?? 0, py = pl.fy;
    fx[k] += px; fy[k] += py; mz[k] += pl.at.x * py - pl.at.y * px;
    W += Math.hypot(px, py);
  }
  if (!(W > 0)) throw new Error('solveArch: no load');

  const joints: JointData[] = [];
  let lx = 0, ly = 0, mo = 0; // accumulated loads of blocks left of the joint (moment about world origin)
  for (let j = 0; j <= n; j++) {
    const [a, b] = arch.joints[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) throw new Error('solveArch: zero-length joint ' + j);
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = -uy, ny = ux;
    const ref = j < n ? props[j] : props[n - 1];
    const toward = (ref.cx - mx) * nx + (ref.cy - my) * ny;
    if ((j < n) !== (toward > 0)) { nx = -nx; ny = -ny; }
    // Moments are carried about the world origin while summing, then shifted to (ox, oy).
    const cx = (mx - ox) / L, cy = (my - oy) / L;
    const sLx = lx / W, sLy = ly / W;
    const sMo = (mo - (ox * ly - oy * lx)) / (W * L);
    joints.push({ cx, cy, ux, uy, nx, ny, h: len / 2 / L, lx: sLx, ly: sLy, mo: sMo });
    if (j < n) { lx += fx[j]; ly += fy[j]; mo += mz[j]; }
  }

  // Fixed, seeded constraint order for the LP (Seidel needs a "random" order; we need determinism).
  const rows = 4 * (n + 1);
  const order = new Uint16Array(rows);
  for (let i = 0; i < rows; i++) order[i] = i;
  let seed = 0x2545f491;
  for (let i = rows - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const k = seed % (i + 1);
    const t = order[i]; order[i] = order[k]; order[k] = t;
  }
  return { joints, L, W, ox, oy, order };
}

// Unknowns x = (X, Y, Mo). For joint j with F = (X + lx, Y + ly):
//   N = n·F,  V = u·F,  m = Mo + mo − C×F  (moment of the joint force about the joint midpoint)
//   eccentricity e = m / (u×F) and |e| <= k·h  ⇔  |m| <= k·h·N
interface Limits { k: number; mu: number } // k = 1 − margin; mu = Infinity drops friction

function solveLP(P: Problem, lim: Limits): Float64Array | null {
  const J = P.joints, nj = J.length;
  const useMu = Number.isFinite(lim.mu);
  const raw = useMu ? 4 : 2;
  const m = 6 + raw * nj;
  const A = new Float64Array(m * 3), b = new Float64Array(m);
  for (let k = 0; k < 3; k++) { A[(2 * k) * 3 + k] = 1; b[2 * k] = BOX; A[(2 * k + 1) * 3 + k] = -1; b[2 * k + 1] = BOX; }
  let r = 6;
  for (let q = 0; q < P.order.length; q++) {
    const id = P.order[q];
    const j = id >> 2, kind = id & 3;
    if (!useMu && kind >= 2) continue;
    const d = J[j];
    const cN = d.nx * d.lx + d.ny * d.ly;
    const o = r * 3;
    if (kind < 2) {
      const cm = d.mo - (d.cx * d.ly - d.cy * d.lx);
      const s = kind === 0 ? 1 : -1, kh = lim.k * d.h;
      // s·m − k h N <= 0
      A[o] = s * d.cy - kh * d.nx; A[o + 1] = -s * d.cx - kh * d.ny; A[o + 2] = s;
      b[r] = -(s * cm - kh * cN);
    } else {
      const cV = d.ux * d.lx + d.uy * d.ly;
      const s = kind === 2 ? 1 : -1;
      // s·V − mu N <= 0
      A[o] = s * d.ux - lim.mu * d.nx; A[o + 1] = s * d.uy - lim.mu * d.ny; A[o + 2] = 0;
      b[r] = -(s * cV - lim.mu * cN);
    }
    r++;
  }
  return lpMax(3, A, b, m, OBJ, BOX);
}
const OBJ = new Float64Array([1, 0, 0]);

/**
 * Largest-margin line of thrust, i.e. min over x of k(x) = max_j |m_j| / (h_j N_j).
 * Generalised fractional programming (Crouzeix, Ferland & Schaible 1985): at the current k,
 * maximise a slack tau with |m_j| + tau h_j N_j(x_prev) <= k h_j N_j, move to that deeper point
 * and set k to what it really reaches. Converges in a handful of LPs instead of a bisection.
 */
function maxMargin(P: Problem, mu: number, xStart: Float64Array): Float64Array {
  const J = P.joints, nj = J.length;
  const useMu = Number.isFinite(mu);
  const m = 8 + (useMu ? 4 : 2) * nj;
  const A = new Float64Array(m * 4), b = new Float64Array(m);
  let x = xStart;
  let k = usedK(P, x);
  for (let it = 0; it < 40; it++) {
    A.fill(0);
    for (let q = 0; q < 4; q++) { A[(2 * q) * 4 + q] = 1; b[2 * q] = BOX; A[(2 * q + 1) * 4 + q] = -1; b[2 * q + 1] = BOX; }
    let r = 8;
    for (let q = 0; q < P.order.length; q++) {
      const id = P.order[q];
      const d = J[id >> 2], kind = id & 3;
      if (!useMu && kind >= 2) continue;
      const cN = d.nx * d.lx + d.ny * d.ly;
      const o = r * 4;
      if (kind < 2) {
        const cm = d.mo - (d.cx * d.ly - d.cy * d.lx);
        const s = kind === 0 ? 1 : -1, kh = k * d.h;
        const Nprev = d.nx * (x[0] + d.lx) + d.ny * (x[1] + d.ly);
        A[o] = s * d.cy - kh * d.nx; A[o + 1] = -s * d.cx - kh * d.ny; A[o + 2] = s; A[o + 3] = d.h * Nprev;
        b[r] = -(s * cm - kh * cN);
      } else {
        const cV = d.ux * d.lx + d.uy * d.ly;
        const s = kind === 2 ? 1 : -1;
        A[o] = s * d.ux - mu * d.nx; A[o + 1] = s * d.uy - mu * d.ny;
        b[r] = -(s * cV - mu * cN);
      }
      r++;
    }
    const y = lpMax(4, A, b, m, TAU, BOX);
    if (!y || y[3] <= 1e-12) break;
    const xn = y.subarray(0, 3);
    const kn = usedK(P, xn);
    if (!(kn < k * (1 - 1e-12))) break;
    x = new Float64Array(xn); k = kn;
  }
  return x;
}
const TAU = new Float64Array([0, 0, 0, 1]);

/** Smallest N/W over all joints can be raised to tau: maximise tau (4 unknowns). */
function maxMinNormal(P: Problem): Float64Array | null {
  const J = P.joints, nj = J.length, m = 8 + nj;
  const A = new Float64Array(m * 4), b = new Float64Array(m);
  for (let k = 0; k < 4; k++) { A[(2 * k) * 4 + k] = 1; b[2 * k] = BOX; A[(2 * k + 1) * 4 + k] = -1; b[2 * k + 1] = BOX; }
  for (let j = 0; j < nj; j++) {
    const d = J[j], o = (8 + j) * 4;
    A[o] = -d.nx; A[o + 1] = -d.ny; A[o + 3] = 1; // tau − N <= 0
    b[8 + j] = d.nx * d.lx + d.ny * d.ly;
  }
  return lpMax(4, A, b, m, new Float64Array([0, 0, 0, 1]), BOX);
}

interface JointState { N: number; V: number; e: number; margin: number }

function evaluate(P: Problem, x: Float64Array): JointState[] {
  return P.joints.map(d => {
    const Fx = x[0] + d.lx, Fy = x[1] + d.ly;
    const N = d.nx * Fx + d.ny * Fy, V = d.ux * Fx + d.uy * Fy;
    const m = x[2] + d.mo - (d.cx * Fy - d.cy * Fx);
    const uxF = d.ux * Fy - d.uy * Fx;
    const e = Math.abs(uxF) > 1e-12 ? m / uxF : (m === 0 ? 0 : Math.sign(m) * Infinity);
    return { N, V, e, margin: 1 - Math.abs(e) / d.h };
  });
}

function thrustPoints(P: Problem, st: JointState[], clamp: boolean): Vec2[] {
  return P.joints.map((d, i) => {
    let e = st[i].e;
    if (clamp || !Number.isFinite(e)) e = Math.max(-d.h, Math.min(d.h, Number.isFinite(e) ? e : Math.sign(e) * d.h));
    return { x: P.ox + P.L * (d.cx + e * d.ux), y: P.oy + P.L * (d.cy + e * d.uy) };
  });
}

/** Bisect for the boundary of a monotone feasibility: feasible at `ok`, infeasible at `bad`. */
function bisect(P: Problem, ok: number, bad: number, lim: (v: number) => Limits, xOk: Float64Array): { v: number; x: Float64Array } {
  let x = xOk;
  for (let i = 0; i < BISECT; i++) {
    const mid = (ok + bad) / 2;
    const r = solveLP(P, lim(mid));
    if (r) { ok = mid; x = r; } else bad = mid;
  }
  return { v: ok, x };
}

/** max_j |e_j| / h_j for a candidate line, i.e. the k = 1 − margin it actually reaches. */
function usedK(P: Problem, x: Float64Array): number {
  let k = 0;
  for (const d of P.joints) {
    const Fx = x[0] + d.lx, Fy = x[1] + d.ly;
    const N = d.nx * Fx + d.ny * Fy;
    const m = x[2] + d.mo - (d.cx * Fy - d.cy * Fx);
    if (N <= 0) return Infinity;
    k = Math.max(k, Math.abs(m) / (d.h * N));
  }
  return k;
}

const minOf = (a: number[]) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const near = (vals: number[], target: number, tol: number) =>
  vals.flatMap((v, i) => (v <= target + tol ? [i] : []));

export function solveArch(arch: Arch, opts: SolveOptions = {}): SolveResult {
  const P = prepare(arch, opts);
  const mu = opts.friction ?? 0.7;

  const x0 = solveLP(P, { k: 1, mu });
  if (x0) {
    // Stands. Push the admissible region inward until it vanishes: k = 1 − margin.
    const x = maxMargin(P, mu, x0);
    const st = evaluate(P, x);
    const margins = st.map(s => s.margin);
    const minMargin = minOf(margins);
    return { stands: true, thrustLine: thrustPoints(P, st, false), minMargin, criticalJoints: near(margins, minMargin, CRITICAL_TOL) };
  }

  // Collapses. Classify, then report the least-bad line of thrust.
  const xNoFriction = solveLP(P, { k: 1, mu: Infinity });
  if (xNoFriction) {
    // Geometry is fine; friction is not. Find the friction coefficient the arch would need.
    let hi = Math.max(2 * mu, 0.05);
    let xHi = solveLP(P, { k: 1, mu: hi });
    while (!xHi && hi < 1e3) { hi *= 4; xHi = solveLP(P, { k: 1, mu: hi }); }
    const { v: need, x } = xHi ? bisect(P, hi, mu, f => ({ k: 1, mu: f }), xHi) : { v: Infinity, x: xNoFriction };
    const st = evaluate(P, x);
    const ratio = st.map(s => (s.N > 0 ? Math.abs(s.V) / s.N : Infinity));
    return {
      stands: false,
      thrustLine: thrustPoints(P, st, false),
      minMargin: mu / need - 1, // in [-1, 0): share of the needed friction that is missing
      criticalJoints: ratio.flatMap((u, i) => (u >= need * (1 - CRITICAL_TOL) ? [i] : [])),
      failure: 'sliding',
    };
  }

  // Can the thrust line exist at all if it may leave the joints (compression only)?
  const kMax = 1e3;
  const xLoose = solveLP(P, { k: kMax, mu: Infinity });
  if (xLoose) {
    // Hinge mechanism: the line must leave the masonry. Find how far it has to go at least.
    const x = maxMargin(P, Infinity, xLoose);
    const st = evaluate(P, x);
    const margins = st.map(s => s.margin);
    const minMargin = Math.min(0, minOf(margins));
    return {
      stands: false,
      thrustLine: thrustPoints(P, st, false),
      minMargin,
      criticalJoints: near(margins, minMargin, CRITICAL_TOL * (1 - minMargin)),
      failure: 'hinge',
    };
  }

  // Some joint would have to pull: report the line with the least tension.
  const xt = maxMinNormal(P);
  const X = xt ? xt.subarray(0, 3) : new Float64Array(3);
  const st = evaluate(P, X);
  const tau = xt ? xt[3] : minOf(st.map(s => s.N));
  return {
    stands: false,
    thrustLine: thrustPoints(P, st, true),
    minMargin: -1,
    criticalJoints: near(st.map(s => s.N), tau, CRITICAL_TOL),
    failure: 'tension',
  };
}

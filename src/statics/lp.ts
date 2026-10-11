// Tiny dense LP for a handful of unknowns: maximise c·x subject to A x <= b and |x_k| <= B.
// Seidel's incremental algorithm (Seidel 1991). Expected linear time when constraints arrive in
// random order; callers pass a fixed, seeded permutation so results stay deterministic.

const EPS = 1e-9;

// One scratch set per dimension: a level-d call only ever has one level-(d-1) call alive, so the
// buffers can be reused and the solver allocates nothing in steady state.
interface Scratch { A: Float64Array; b: Float64Array; c: Float64Array; x: Float64Array }
const scratch: Scratch[] = [];
function level(d: number, rows: number): Scratch {
  let s = scratch[d];
  if (!s || s.b.length < rows) {
    const cap = Math.max(rows, 64, s ? 2 * s.b.length : 0);
    s = { A: new Float64Array(cap * d), b: new Float64Array(cap), c: new Float64Array(d), x: new Float64Array(d) };
    scratch[d] = s;
  }
  return s;
}

/**
 * @param d  number of unknowns
 * @param A  row-major constraint matrix, m rows of d coefficients
 * @param b  right-hand sides, length m
 * @param m  number of rows to use
 * @param c  objective, length d (maximised)
 * @param B  box half-width; every |x_k| <= B. The first 2d rows of A must be that box.
 * @returns an optimal x (a fresh array), or null when infeasible
 */
export function lpMax(d: number, A: Float64Array, b: Float64Array, m: number, c: Float64Array, B: number): Float64Array | null {
  const x = solve(d, A, b, m, c, B);
  return x && x.slice(0, d);
}

function solve(d: number, A: Float64Array, b: Float64Array, m: number, c: Float64Array, B: number): Float64Array | null {
  const x = level(d, 0).x;
  if (d === 1) {
    // Base case: intersect the half-lines directly.
    let lo = -B, hi = B;
    for (let j = 0; j < m; j++) {
      const a = A[j];
      if (Math.abs(a) < 1e-14) { if (b[j] < -EPS) return null; }
      else if (a > 0) { const v = b[j] / a; if (v < hi) hi = v; }
      else { const v = b[j] / a; if (v > lo) lo = v; }
    }
    if (lo > hi + EPS) return null;
    x[0] = lo > hi ? (lo + hi) / 2 : c[0] >= 0 ? hi : lo;
    return x;
  }
  for (let k = 0; k < d; k++) x[k] = c[k] >= 0 ? B : -B;
  for (let i = 0; i < m; i++) {
    const o = i * d;
    let s = 0;
    for (let k = 0; k < d; k++) s += A[o + k] * x[k];
    if (s <= b[i] + EPS) continue;

    // The optimum of rows 0..i moves onto the hyperplane of row i. Eliminate its largest
    // coefficient and solve the (d-1)-dimensional problem over the earlier rows.
    let p = 0;
    let best = 0;
    for (let k = 0; k < d; k++) {
      const v = Math.abs(A[o + k]);
      if (v > best) { best = v; p = k; }
    }
    if (best < 1e-14) return null; // 0 <= b with b < 0
    const ap = A[o + p];
    const d1 = d - 1;
    const sub = level(d1, i);
    const A2 = sub.A, b2 = sub.b, c2 = sub.c;
    for (let j = 0; j < i; j++) {
      const oj = j * d;
      const f = A[oj + p] / ap;
      let q = j * d1;
      for (let k = 0; k < d; k++) if (k !== p) A2[q++] = A[oj + k] - f * A[o + k];
      b2[j] = b[j] - f * b[i];
    }
    const fc = c[p] / ap;
    for (let k = 0, q = 0; k < d; k++) if (k !== p) c2[q++] = c[k] - fc * A[o + k];

    const y = solve(d1, A2, b2, i, c2, B);
    if (!y) return null;
    let r = b[i];
    for (let k = 0, q = 0; k < d; k++) {
      if (k === p) continue;
      x[k] = y[q++];
      r -= A[o + k] * x[k];
    }
    x[p] = r / ap;
  }
  return x;
}

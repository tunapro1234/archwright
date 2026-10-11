// Arch geometry generators. Voussoirs are straight-edged quads between consecutive joints
// (convex, CCW), so a block is exactly what the solver and the renderer both see.
import type { Arch, Block, Vec2 } from './index.js';

/** Semicircular arch: centre-line radius R, ring thickness t, n voussoirs, springings on y = 0. */
export function semicircularArch(p: { R: number; t: number; n: number; depth?: number }): Arch {
  return pointedArch({ span: 2 * p.R, rise: p.R, t: p.t, n: p.n, depth: p.depth });
}

export interface PointedArchParams { span: number; rise: number; t: number; n: number; depth?: number }

/**
 * Two-centred (pointed) arch measured on its centre line: springings at (±span/2, 0), apex at
 * (0, rise). Each half is a circular arc whose centre sits on the springing line, so the
 * springing joints are horizontal. rise = span/2 gives the semicircle; rise > span/2 is pointed.
 * With an even n the crown joint is vertical through the apex; with an odd n a keystone sits on it.
 */
export function pointedArch(p: PointedArchParams): Arch;
export function pointedArch(span: number, rise: number, t: number, n: number, depth?: number): Arch;
export function pointedArch(a: PointedArchParams | number, rise?: number, t?: number, n?: number, depth?: number): Arch {
  const p: PointedArchParams = typeof a === 'number' ? { span: a, rise: rise!, t: t!, n: n!, depth } : a;
  const half = p.span / 2;
  if (!(p.span > 0 && p.t > 0 && p.n >= 1 && Number.isInteger(p.n))) throw new Error('pointedArch: span, t > 0 and integer n >= 1');
  if (p.rise < half - 1e-12) throw new Error('pointedArch: rise must be at least span/2');
  if (p.t / 2 >= half) throw new Error('pointedArch: ring thickness too large for the span');

  // Left arc centre (c, 0), radius rho: passes through (-half, 0) and (0, rise).
  const c = Math.max(0, (p.rise * p.rise - half * half) / p.span);
  const rho = half + c;
  const ri = rho - p.t / 2;
  const ro = rho + p.t / 2;
  // Angular sweep of one half, measured at its own centre.
  const sweep = Math.PI - Math.atan2(p.rise, -c);

  const joints: [Vec2, Vec2][] = [];
  for (let j = 0; j <= p.n; j++) {
    const phi = (2 * sweep * j) / p.n; // distance along the arch, as an angle
    if (2 * j === p.n) {
      // Crown joint: vertical, between the intersections of the two intrados / extrados circles.
      joints.push([{ x: 0, y: Math.sqrt(ri * ri - c * c) }, { x: 0, y: Math.sqrt(ro * ro - c * c) }]);
    } else if (2 * j < p.n) {
      const th = Math.PI - phi;
      const ux = Math.cos(th), uy = Math.sin(th);
      joints.push([{ x: c + ri * ux, y: ri * uy }, { x: c + ro * ux, y: ro * uy }]);
    } else {
      const th = 2 * sweep - phi;
      const ux = Math.cos(th), uy = Math.sin(th);
      joints.push([{ x: -c + ri * ux, y: ri * uy }, { x: -c + ro * ux, y: ro * uy }]);
    }
  }
  // Exact zeros on the springing line (cos/sin round-off would leave ~1e-17).
  for (const q of [...joints[0], ...joints[p.n]]) q.y = 0;

  const blocks: Block[] = [];
  for (let i = 0; i < p.n; i++) {
    const [a0, b0] = joints[i];
    const [a1, b1] = joints[i + 1];
    blocks.push({ vertices: [{ ...a0 }, { ...a1 }, { ...b1 }, { ...b0 }] });
  }
  return { blocks, joints, depth: p.depth ?? 1 };
}

/** One stone of a ring: how many courses of the centering it covers, its radial thickness and density. */
export interface RingPiece { units: number; t: number; density?: number }
export interface RingArchParams {
  span: number;          // intrados (centering) span, springing to springing
  rise: number;          // intrados rise; rise = span/2 is a semicircle, more is pointed
  units: number;         // the centering is divided into this many equal courses
  pieces: RingPiece[];   // left to right; their units must add up to `units`
  depth?: number;
}

/**
 * A ring laid on a centering: the intrados is the (two-centred) centering curve, every joint is
 * radial, and each stone keeps its own thickness. Where a thick stone meets a thin one, they only
 * touch over the thin one's depth, so the joint is the shorter of the two faces. This is the arch
 * the player actually builds; `pointedArch` is the uniform special case measured on the centre line.
 */
export function ringArch(p: RingArchParams): Arch {
  const half = p.span / 2;
  if (!(p.span > 0 && Number.isInteger(p.units) && p.units >= 1)) throw new Error('ringArch: span > 0 and integer units >= 1');
  if (p.rise < half - 1e-12) throw new Error('ringArch: rise must be at least span/2');
  if (p.pieces.reduce((s, q) => s + q.units, 0) !== p.units) throw new Error('ringArch: pieces must cover every course');
  const c = Math.max(0, (p.rise * p.rise - half * half) / p.span);
  const rho = half + c;
  const sweep = Math.PI - Math.atan2(p.rise, -c);
  const n = p.units;

  // Point on the radial line at course boundary k, at distance r from that half's centre.
  const at = (k: number, r: number): Vec2 => {
    if (2 * k === n) return { x: 0, y: Math.sqrt(r * r - c * c) };
    const phi = (2 * sweep * k) / n;
    const left = 2 * k < n;
    const th = left ? Math.PI - phi : 2 * sweep - phi;
    const y = k === 0 || k === n ? 0 : r * Math.sin(th);
    return { x: (left ? c : -c) + r * Math.cos(th), y };
  };

  const blocks: Block[] = [];
  const joints: [Vec2, Vec2][] = [];
  let k = 0;
  p.pieces.forEach((q, i) => {
    if (!(q.units >= 1 && Number.isInteger(q.units) && q.t > 0)) throw new Error('ringArch: bad piece ' + i);
    const k1 = k + q.units;
    const ro = rho + q.t;
    blocks.push({ vertices: [at(k, rho), at(k1, rho), at(k1, ro), at(k, ro)], density: q.density });
    const tLeft = i > 0 ? Math.min(p.pieces[i - 1].t, q.t) : q.t;
    joints.push([at(k, rho), at(k, rho + tLeft)]);
    k = k1;
  });
  joints.push([at(n, rho), at(n, rho + p.pieces[p.pieces.length - 1].t)]);
  return { blocks, joints, depth: p.depth ?? 1 };
}

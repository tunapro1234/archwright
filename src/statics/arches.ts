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

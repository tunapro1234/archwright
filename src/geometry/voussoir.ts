/** A point in the arch plane, in metres. x is horizontal, y is up. */
export type Point2 = { x: number; y: number };

export interface VoussoirSpec {
  /** Intrados (inner) radius in metres. */
  innerRadius: number;
  /** Radial thickness of the ring in metres. */
  thickness: number;
  /** Start and end angle of the wedge in radians, measured from +x, CCW. */
  fromAngle: number;
  toAngle: number;
}

/**
 * Outline of one wedge stone (voussoir) cut from a circular ring.
 * Returns a convex quadrilateral in counter-clockwise order:
 * inner-start, outer-start, outer-end, inner-end.
 */
export function voussoirOutline(spec: VoussoirSpec): Point2[] {
  const { innerRadius: ri, thickness, fromAngle: a0, toAngle: a1 } = spec;
  if (!(ri > 0) || !(thickness > 0) || !(a1 > a0)) {
    throw new Error('voussoirOutline: need innerRadius > 0, thickness > 0, toAngle > fromAngle');
  }
  const ro = ri + thickness;
  const at = (r: number, a: number): Point2 => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
  // Walking inner-start -> outer-start -> outer-end -> inner-end turns left at each corner.
  return [at(ri, a0), at(ro, a0), at(ro, a1), at(ri, a1)];
}

/** Signed area of a simple polygon (positive when counter-clockwise). */
export function polygonArea(points: Point2[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    twice += p.x * q.y - q.x * p.y;
  }
  return twice / 2;
}

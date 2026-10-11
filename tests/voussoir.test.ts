import { describe, expect, it } from 'vitest';
import { polygonArea, voussoirOutline } from '../src/geometry/voussoir.js';

describe('voussoirOutline', () => {
  const spec = { innerRadius: 0.15, thickness: 0.05, fromAngle: Math.PI / 2 - 0.13, toAngle: Math.PI / 2 + 0.13 };

  it('is counter-clockwise with the area of a ring sector', () => {
    const pts = voussoirOutline(spec);
    expect(pts).toHaveLength(4);
    // Exact sector area is (ro^2 - ri^2) * dθ / 2; the straight-edged quad is slightly smaller.
    const ro = spec.innerRadius + spec.thickness;
    const dTheta = spec.toAngle - spec.fromAngle;
    const quad = ((ro * ro - spec.innerRadius ** 2) * Math.sin(dTheta)) / 2;
    expect(polygonArea(pts)).toBeCloseTo(quad, 12);
  });

  it('is mirror-symmetric when centred on the crown', () => {
    const [a, b, c, d] = voussoirOutline(spec);
    expect(a.x).toBeCloseTo(-d.x, 12);
    expect(b.x).toBeCloseTo(-c.x, 12);
    expect(a.y).toBeCloseTo(d.y, 12);
  });

  it('rejects degenerate input', () => {
    expect(() => voussoirOutline({ ...spec, thickness: 0 })).toThrow();
    expect(() => voussoirOutline({ ...spec, toAngle: spec.fromAngle })).toThrow();
  });
});

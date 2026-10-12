// Legibility of both palettes, as the README reports it: CIE ΔE76 between the stones and against the
// timber, the same under a protan/deutan/tritan simulation (Machado, Oliveira, Fernandes 2009,
// severity 1.0), and the WCAG luminance contrast ratio between the three stones.
import { describe, expect, it } from 'vitest';
import { HIGH_CONTRAST, PALETTE, type Palette } from '../src/scene/palette.js';

type RGB = [number, number, number];
const rgb = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map(v => v / 255) as RGB;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const enc = (c: number) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
const lum = (c: RGB) => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab(c: RGB): RGB {
  const [r, g, b] = c.map(lin);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const dE = (a: RGB, b: RGB) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const CVD: number[][][] = [
  [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
];
const sim = (c: RGB, m: number[][]): RGB => { const v = c.map(lin); return m.map(r => enc(r[0] * v[0] + r[1] * v[1] + r[2] * v[2])) as RGB; };

const STONES = ['sandstone', 'tuff', 'basalt'] as const;
function measure(p: Palette) {
  let stones = Infinity, timber = Infinity, blind = Infinity, contrast = Infinity;
  const pairs: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    pairs.push([p[STONES[i]], p.centering]);
    timber = Math.min(timber, dE(rgb(p[STONES[i]]), rgb(p.centering)));
    for (let j = i + 1; j < 3; j++) {
      pairs.push([p[STONES[i]], p[STONES[j]]]);
      stones = Math.min(stones, dE(rgb(p[STONES[i]]), rgb(p[STONES[j]])));
      contrast = Math.min(contrast, ratio(rgb(p[STONES[i]]), rgb(p[STONES[j]])));
    }
  }
  for (const m of CVD) for (const [a, b] of pairs) blind = Math.min(blind, dE(sim(rgb(a), m), sim(rgb(b), m)));
  return { stones, timber, blind, contrast };
}

describe('palette legibility (numbers in the README)', () => {
  it('normal palette', () => {
    const r = measure(PALETTE);
    expect(r.stones).toBeCloseTo(35.5, 1);
    expect(r.timber).toBeCloseTo(38.0, 1);
    expect(r.blind).toBeCloseTo(25.4, 1);
    expect(r.contrast).toBeCloseTo(2.32, 2);
  });

  it('high-contrast palette: every margin well above the normal one', () => {
    const r = measure(HIGH_CONTRAST);
    expect(r.stones).toBeCloseTo(80.7, 1);
    expect(r.timber).toBeCloseTo(120.1, 1);
    expect(r.blind).toBeCloseTo(51.9, 1);
    expect(r.contrast).toBeCloseTo(3.97, 2);
    const n = measure(PALETTE);
    for (const k of ['stones', 'timber', 'blind', 'contrast'] as const) expect(r[k]).toBeGreaterThan(n[k] * 1.4);
  });
});

// Procedural meshes and materials. Everything is built in code: no texture files, models or fonts.
import {
  BackSide, BoxGeometry, BufferGeometry, CapsuleGeometry, Quaternion, CanvasTexture, CatmullRomCurve3, Color, DataTexture, ExtrudeGeometry,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, MeshStandardMaterial, NoColorSpace, RepeatWrapping, RGBAFormat,
  ConeGeometry, CylinderGeometry, InstancedMesh, LatheGeometry, RingGeometry, Shape, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2,
  Vector3,
} from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec2 } from '../statics/index.js';
import type { Stroke } from '../statics/failure-view.js';
import type { LoadKind, Material } from '../game/arch-state.js';
import { A11Y_ICONS, A11Y_PANEL, a11yIconSpot, ABUTMENT_HEIGHT, BOARD, CENTERING, MARKER, PLAQUE, TABLET } from './layout.js';
import { COLORS, paint, type PaletteKey } from './palette.js';
import { MATERIAL_COLOR } from './meshes.js';

/** Chamfer on every stone edge (m): it catches the light, so a stone reads as a cut block. */
export const STONE_BEVEL = 0.003;

/** A prism over `outline` (x-y), `depth` deep in z, centred on z = 0, with a chamfer on its edges. */
export function prism(outline: Vec2[], depth: number, bevel = STONE_BEVEL): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i].x, outline[i].y);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth: depth - 2 * bevel,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}

// Deterministic hash and tileable value noise: nothing here uses Math.random.
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(size: number) {
  return (x: number, y: number, cell: number) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const n = size / cell, fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (i: number, j: number) => hash(((x0 + i) % n + n) % n, ((y0 + j) % n + n) % n);
    return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
  };
}

function dataTexture(size: number, data: Uint8Array, color: boolean): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Grey grain in [lo, 1]: tinted by the material colour (and per instance for stones). */
function grainTexture(size: number, lo: number): DataTexture {
  const smooth = valueNoise(size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.5 * smooth(x, y, 16) + 0.3 * smooth(x, y, 8) + 0.2 * smooth(x, y, 2);
      const v = Math.round(255 * (lo + (1 - lo) * n));
      const o = 4 * (y * size + x);
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return dataTexture(size, data, true);
}

/** Height field -> tangent-space normal map (central differences, wrapping). */
function normalTexture(size: number, height: Float32Array, strength: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = 4 * (y * size + x);
      data[o] = Math.round(127.5 * (1 - dx / len));
      data[o + 1] = Math.round(127.5 * (1 - dy / len));
      data[o + 2] = Math.round(127.5 * (1 + 1 / len));
      data[o + 3] = 255;
    }
  }
  return dataTexture(size, data, false);
}

/**
 * Tooled stone: rows of short diagonal chisel strokes over a pitted grain, as on a dressed ashlar
 * face. Baked into a normal map, so every stone shares one material and stays one instanced draw.
 */
function chiselNormals(size: number): DataTexture {
  const smooth = valueNoise(size);
  const height = new Float32Array(size * size);
  const band = 16; // px per row of strokes
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / band);
    for (let x = 0; x < size; x++) {
      // Strokes lean one way, alternate rows the other way (a mason working back and forth).
      const lean = row % 2 ? 1 : -1;
      const u = x + lean * (y % band) * 0.7 + hash(row, 7) * size;
      const stroke = 0.5 - 0.5 * Math.cos((2 * Math.PI * u) / 6);
      const fade = Math.sin((Math.PI * (y % band)) / band); // strokes taper to the row edges
      const pit = smooth(x, y, 4) > 0.82 ? -0.6 : 0;
      height[y * size + x] = 0.55 * stroke * fade + 0.35 * smooth(x, y, 8) + 0.25 * smooth(x, y, 32) + pit;
    }
  }
  return normalTexture(size, height, 1.2);
}

/** The one stone material: grain and chisel marks, white so each instance's colour shows true. */
export function stoneMaterial(): MeshStandardMaterial {
  const map = grainTexture(64, 0.8);
  map.repeat.set(14, 14); // extrude UVs are in metres: ~7 cm per tile
  const normalMap = chiselNormals(128);
  normalMap.repeat.set(9, 9); // ~11 cm per tile, strokes ~5 mm apart
  return new MeshStandardMaterial({
    color: 0xffffff, map, normalMap, normalScale: new Vector2(1.25, 1.25), roughness: 0.93, metalness: 0,
  });
}

/** The piers: the same tooled stone in a colour none of the playable stones has. */
export function abutmentMaterial(stone: MeshStandardMaterial): MeshStandardMaterial {
  const m = stone.clone();
  paint(m.color, 'abutment');
  return m;
}

/**
 * The abutments as one mesh of cut ashlar blocks (layout ashlarBlocks, site frame): every block
 * chamfered, so the joints read as grooves, and each a shade lighter or darker than the next
 * (a vertex colour under the palette colour). One draw call for both piers.
 */
export function ashlarMesh(blocks: { x: number; y: number; z: number; w: number; h: number; d: number }[], material: MeshStandardMaterial): Mesh {
  const parts = blocks.map(b => prism([
    { x: -b.w / 2, y: -b.h / 2 }, { x: b.w / 2, y: -b.h / 2 }, { x: b.w / 2, y: b.h / 2 }, { x: -b.w / 2, y: b.h / 2 },
  ], b.d, 0.0022).translate(b.x, b.y, b.z));
  const counts = parts.map(g => (g.index ? g.index.count : g.getAttribute('position').count));
  const geo = weld(parts);
  const color = new Float32Array(geo.getAttribute('position').count * 3);
  let at = 0;
  counts.forEach((n, i) => {
    const tone = 0.84 + 0.16 * hash(i, 17);
    color.fill(tone, at * 3, (at + n) * 3);
    at += n;
  });
  geo.setAttribute('color', new Float32BufferAttribute(color, 3));
  const m = new Mesh(geo, material);
  m.name = 'abutments';
  return m;
}

/** The ashlar's material: the piers' tooled stone, toned per block by vertex colour. */
export function ashlarMaterial(stone: MeshStandardMaterial): MeshStandardMaterial {
  const m = stone.clone();
  m.vertexColors = true;
  paint(m.color, 'abutment');
  return m;
}

/**
 * Timber for the centering: horizontal planks of uneven tone with dark seams, staggered butt joints,
 * long grain streaks and the odd knot. Drawn once on a canvas; the same image is the bump map.
 */
function plankTexture(size: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const smooth = valueNoise(size);
  const rows = 8, rowH = size / rows;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rowH), inRow = y - r * rowH;
    const tone = 0.82 + 0.18 * hash(r, 3);
    const joint = Math.floor(hash(r, 11) * size);
    for (let x = 0; x < size; x++) {
      const grain = 0.6 * smooth(x, y * 10, 32) + 0.4 * smooth(x, y * 10, 8);
      let v = tone * (0.8 + 0.2 * grain);
      if (inRow < 2 || (x - joint + size) % size < 2) v *= 0.45; // seams
      // A knot or two per plank: darker rings around a point.
      const kx = Math.floor(hash(r, 5) * size), ky = r * rowH + rowH / 2;
      const dk = Math.hypot((x - kx) * 0.6, y - ky);
      if (hash(r, 9) > 0.45 && dk < rowH * 0.32) v *= 0.7 + 0.3 * Math.abs(Math.sin(dk * 1.4));
      const o = 4 * (y * size + x);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(255 * v);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Plank timber: the centering. Planks are ~3 cm wide, a tile covers 25 cm. Painted from palette `key`. */
export function woodMaterial(key: PaletteKey = 'centering', repeat = 4): MeshStandardMaterial {
  const map = plankTexture(256);
  map.repeat.set(repeat, repeat);
  const bumpMap = map.clone();
  bumpMap.colorSpace = NoColorSpace;
  const m = new MeshStandardMaterial({ map, bumpMap, bumpScale: 1.5, roughness: 0.78, metalness: 0 });
  paint(m.color, key);
  return m;
}

/**
 * The snap ghost: where the held stone will sit if released now. Flat, see-through, and lifted
 * towards white so a dark basalt ghost still shows against the arch.
 */
export function ghostMesh(name: string): Mesh {
  const m = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
  m.name = name;
  m.visible = false;
  m.renderOrder = 3;
  return m;
}

const WHITE = new Color(0xffffff);
export function ghostColor(material: Material, out: Color): Color {
  return out.setHex(MATERIAL_COLOR[material]).lerp(WHITE, 0.35);
}

/**
 * A plain, finely grained surface: the board and the virtual desk (no planks, so not timber).
 * A palette key paints it (and repaints it with the palette); a number is a fixed colour.
 */
export function flatMaterial(color: number | PaletteKey): MeshStandardMaterial {
  const map = grainTexture(64, 0.88);
  map.repeat.set(8, 8);
  const m = new MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 });
  if (typeof color === 'number') m.color.setHex(color);
  else paint(m.color, color);
  return m;
}

/**
 * The centering's open timber frame (m): two curved ribs, one at the front and one at the back, each a
 * band `rib` deep below the lagging and `ribThick` thick; laths `lath` wide along the curve and `lathThick`
 * deep laid across them, `lathGap` apart, their tops on the intrados; and three posts `post` wide down to
 * the board, one under each springing and one under the crown.
 */
export const CENTERING_FRAME = { rib: 0.012, ribThick: 0.008, lath: 0.008, lathThick: 0.004, lathGap: 0.022, post: 0.01 } as const;

/** A flat outline (x-y) as a slab from z0 to z1, no bevel. */
function slab(outline: Vec2[], z0: number, z1: number): BufferGeometry {
  const g = new ExtrudeGeometry(new Shape(outline.map(p => new Vector2(p.x, p.y))), { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z0);
  return g;
}

/** A mitre at a sharp corner is cut at this many times the offset. */
const MITRE_MAX = 4;

/** `pts` moved `by` towards the inside of the curve (to the right of its direction): left to right, that is down. */
export function offsetInward(pts: Vec2[], by: number): Vec2[] {
  // Each segment's inward normal; a vertex moves to where its two segments' offset lines meet (a mitre), so the line
  // stays parallel to the curve, and a sharp crown (a pointed arch) gets a point below it instead of folding back.
  const nrm = pts.slice(1).map((p, i) => {
    const a = pts[i], len = Math.hypot(p.x - a.x, p.y - a.y) || 1;
    return { x: (p.y - a.y) / len, y: -(p.x - a.x) / len };
  });
  const out = pts.map((p, i) => {
    const n0 = nrm[Math.max(0, i - 1)], n1 = nrm[Math.min(nrm.length - 1, i)];
    // m = n0 + n1 points along the mitre; p + m·t sits `by` off both segments when t = by / (m·n1). At most MITRE_MAX·by long.
    const mx = n0.x + n1.x, my = n0.y + n1.y, ml = Math.hypot(mx, my);
    if (ml < 1e-9) return { x: p.x + n1.x * by, y: p.y + n1.y * by };
    const t = Math.min(by / (mx * n1.x + my * n1.y), (MITRE_MAX * by) / ml);
    return { x: p.x + mx * t, y: p.y + my * t };
  });
  // Seen from the front the curve only runs left to right; drop any point the offset still pushed back.
  const kept: Vec2[] = [];
  for (const p of out) if (!kept.length || p.x > kept[kept.length - 1].x) kept.push(p);
  return kept;
}

/** The point at arc length `s` along `pts`, and the direction there. */
function alongCurve(pts: Vec2[], s: number): { p: Vec2; t: Vec2 } {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (s <= len || i === pts.length - 1) {
      const f = len > 0 ? Math.min(1, s / len) : 0;
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, t: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
    }
    s -= len;
  }
  return { p: pts[0], t: { x: 1, y: 0 } };
}

/**
 * Wooden centering under the intrados, standing on the board, with a pull handle at the front: an open
 * frame (CENTERING_FRAME), not a solid board, so the stones it carries stay in view. One geometry.
 */
export function centeringMesh(top: Vec2[], depth: number, material: MeshStandardMaterial): Mesh {
  // Shrunk by a millimetre or two so it never z-fights with the stones resting on it.
  const inset = 0.0015;
  const half = top[top.length - 1].x;
  const k = 1 - inset / half;
  const curve = top.map(p => ({ x: p.x * k, y: p.y - inset }));
  const d = depth * 0.92;
  const F = CENTERING_FRAME;
  const parts: BufferGeometry[] = [];

  // Laths: short planks across the full depth, each a chord of the curve, its ends on the intrados.
  let L = 0;
  for (let i = 1; i < curve.length; i++) L += Math.hypot(curve[i].x - curve[i - 1].x, curve[i].y - curve[i - 1].y);
  const n = Math.max(2, Math.floor((L + F.lathGap) / (F.lath + F.lathGap)));
  const pitch = (L - F.lath) / (n - 1);
  for (let i = 0; i < n; i++) {
    const a = alongCurve(curve, i * pitch).p, b = alongCurve(curve, i * pitch + F.lath).p;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (b.y - a.y) / len * F.lathThick, ny = -(b.x - a.x) / len * F.lathThick;
    parts.push(slab([a, { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, b], -d / 2, d / 2));
  }

  // Ribs under the laths, at the front and the back.
  const ribTop = offsetInward(curve, F.lathThick), ribBottom = offsetInward(curve, F.lathThick + F.rib);
  const rib = [...ribTop, ...[...ribBottom].reverse()].reverse(); // counter-clockwise
  parts.push(slab(rib, d / 2 - F.ribThick, d / 2), slab(rib, -d / 2, -d / 2 + F.ribThick));

  // Posts to the board: under each springing (where the rib ends) and under the crown, the full depth.
  const crown = ribBottom.reduce((m, p) => (Math.abs(p.x) < Math.abs(m.x) ? p : m));
  const post = (x0: number, x1: number, y: number): Vec2[] =>
    [{ x: x0, y: -ABUTMENT_HEIGHT }, { x: x1, y: -ABUTMENT_HEIGHT }, { x: x1, y }, { x: x0, y }];
  parts.push(
    slab(post(-half * k, -half * k + F.post, Math.min(ribBottom[0].y, ribTop[0].y)), -d / 2, d / 2),
    slab(post(half * k - F.post, half * k, Math.min(ribBottom[ribBottom.length - 1].y, ribTop[ribTop.length - 1].y)), -d / 2, d / 2),
    slab(post(-F.post / 2, F.post / 2, crown.y), -d / 2, d / 2),
  );

  const body = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();
  const mesh = new Mesh(body, material);
  mesh.name = 'centering';
  const handle = new Mesh(new BoxGeometry(0.07, 0.022, CENTERING.handleDepth), material);
  handle.name = 'centering-handle';
  handle.position.set(0, -ABUTMENT_HEIGHT + 0.022, d / 2 + CENTERING.handleDepth / 2);
  mesh.add(handle);
  return mesh;
}

export function boardMesh(material: MeshStandardMaterial): Mesh {
  const depth = BOARD.zMax - BOARD.zMin;
  const g = new BoxGeometry(BOARD.width, BOARD.thickness, depth);
  g.translate(0, -BOARD.thickness / 2, (BOARD.zMin + BOARD.zMax) / 2);
  const m = new Mesh(g, material);
  m.name = 'board';
  return m;
}

/** Soft shadow under the arch: one transparent quad with a radial gradient. No real-time shadows. */
export function blobShadow(width: number, depth: number): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  const geo = new BoxGeometry(width, 0.0001, depth);
  const m = new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.name = 'blob-shadow';
  m.position.y = 0.0006;
  m.renderOrder = 1;
  return m;
}

/** The line of thrust: one tube through the joint points, just in front of the stones. */
export function thrustTube(points: Vec2[], z: number): Mesh {
  const pts = points.map(p => new Vector3(p.x, p.y, z));
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const geo = new TubeGeometry(curve, Math.max(24, pts.length * 6), 0.0022, 6, false);
  const mat = new MeshBasicMaterial({ color: COLORS.thrust, transparent: true, opacity: 0, depthTest: true });
  const m = new Mesh(geo, mat);
  m.name = 'thrust-line';
  m.renderOrder = 2;
  return m;
}

/**
 * Why an arch fell (src/statics/failure-view.ts): every stroke (arch frame) a thin tube in the z = `z` plane, all welded
 * into one geometry with one material, so the whole drawing is one draw call. It starts invisible; StaticsSystem fades it.
 */
export function failureMesh(strokes: Stroke[], z: number): Mesh {
  const SIDES = 6;
  const pos: number[] = [], index: number[] = [];
  for (const { points: p, radius } of strokes) {
    const base = pos.length / 3;
    for (let i = 0; i < p.length; i++) {
      // The strokes lie in a plane: the tube's frame is the in-plane normal and z.
      const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      for (let k = 0; k < SIDES; k++) {
        const t = (2 * Math.PI * k) / SIDES, c = Math.cos(t) * radius[i], s = Math.sin(t) * radius[i];
        pos.push(p[i].x + nx * c, p[i].y + ny * c, z + s);
      }
    }
    for (let i = 0; i + 1 < p.length; i++) {
      for (let k = 0; k < SIDES; k++) {
        const a = base + i * SIDES + k, b = base + i * SIDES + ((k + 1) % SIDES);
        index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES); // wound outwards
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  const mat = new MeshBasicMaterial({ color: COLORS.thrustFail, transparent: true, opacity: 0, depthTest: true });
  const m = new Mesh(geo, mat);
  m.name = 'failure-marks';
  m.renderOrder = 2;
  return m;
}

/** The last collapse's broken joints on the same level built again (src/statics/failure-view.ts memoryStrokes): small
 *  rings, one mesh, in the failure colour at half the marks' resting opacity, drawn over the snap ghosts. */
export function memoryMesh(strokes: Stroke[], z: number, opacity: number): Mesh {
  const m = failureMesh(strokes, z);
  m.name = 'failure-memory';
  const mat = m.material as MeshBasicMaterial;
  mat.opacity = opacity;
  mat.depthWrite = false;
  m.renderOrder = 4; // after the ghosts (3), which write no depth either
  return m;
}

/** Boxes ({size, centre}) welded into one geometry, so a piece of furniture is one draw call. */
function boxes(parts: { w: number; h: number; d: number; x: number; y: number; z: number }[]): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const b of parts) {
    const g = new BoxGeometry(b.w, b.h, b.d).toNonIndexed();
    g.translate(b.x, b.y, b.z);
    pos.push(...(g.getAttribute('position').array as Float32Array));
    nor.push(...(g.getAttribute('normal').array as Float32Array));
    // Planks run along the longest side whatever the box: scale UVs by the face size in metres.
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      const u = ax > 0.5 ? p.getZ(i) : p.getX(i);
      const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
      uv.push(u, v);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return out;
}

export const ATELIER_DESK = { width: 1.2, depth: 0.7, height: 0.74, top: 0.035 } as const;
/** The atelier's back wall (desk-top frame): where the shelf and the window hang. */
const BACK_WALL = 0.6 - 2.1;
const ATELIER_SHELF = [
  { w: 0.7, h: 0.022, d: 0.16, x: -0.75, y: 0.5, z: BACK_WALL + 0.08 },
  ...[-1, 1].map(k => ({ w: 0.02, h: 0.1, d: 0.12, x: -0.75 + k * 0.28, y: 0.44, z: BACK_WALL + 0.06 })),
  { w: 0.09, h: 0.07, d: 0.09, x: -0.95, y: 0.546, z: BACK_WALL + 0.08 },
  { w: 0.06, h: 0.11, d: 0.07, x: -0.84, y: 0.566, z: BACK_WALL + 0.08 },
  { w: 0.13, h: 0.045, d: 0.1, x: -0.58, y: 0.533, z: BACK_WALL + 0.08 },
];
const ATELIER_WINDOW = (() => {
  const w = 0.8, h = 0.95, x = 0.8, y = 0.75, z = BACK_WALL + 0.004, f = 0.05, fd = 0.06;
  return {
    w, h, x, y, z,
    frame: [
      { w: w + 2 * f, h: f, d: fd, x, y: y + h / 2 + f / 2, z: z + fd / 2 },
      { w: w + 2 * f, h: f * 1.4, d: fd * 1.6, x, y: y - h / 2 - f * 0.7, z: z + fd * 0.8 }, // sill
      ...[-1, 1].map(k => ({ w: f, h, d: fd, x: x + k * (w / 2 + f / 2), y, z: z + fd / 2 })),
      { w: 0.025, h, d: fd * 0.6, x, y, z: z + fd * 0.3 }, // mullion
      { w, h: 0.025, d: fd * 0.6, x, y: y + h * 0.12, z: z + fd * 0.3 }, // transom
    ],
  };
})();

/**
 * The atelier for opaque VR: a plain room and a wooden desk, origin at the centre of the desk top,
 * the player on +z. Two draw calls: the room box seen from inside, and the desk (top and legs in one).
 */
export function atelier(): Group {
  const g = new Group();
  g.name = 'atelier';
  const D = ATELIER_DESK;
  const leg = 0.05, lx = D.width / 2 - 0.06, lz = D.depth / 2 - 0.06, lh = D.height - D.top;
  const desk = new Mesh(boxes([
    { w: D.width, h: D.top, d: D.depth, x: 0, y: -D.top / 2, z: 0 },
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ w: leg, h: lh, d: leg, x: sx * lx, y: -D.top - lh / 2, z: sz * lz })),
    { w: D.width - 0.12, h: 0.08, d: 0.02, x: 0, y: -D.top - 0.04, z: -lz }, // apron at the back
    // On the back wall: a plank shelf on two brackets with a few blocks on it, and a window frame.
    ...ATELIER_SHELF,
    ...ATELIER_WINDOW.frame,
  ]), woodMaterial('workbench', 2.5));
  desk.name = 'atelier-desk';
  g.add(desk);
  const room = new Mesh(new BoxGeometry(4.2, 2.8, 4.2), flatMaterial('room'));
  (room.material as MeshStandardMaterial).side = BackSide;
  room.name = 'atelier-room';
  room.position.set(0, 1.4 - D.height, 0.6); // floor under the desk legs, the player inside
  g.add(room);
  // Daylight through the window: an unlit warm pane, the brightest thing in the room.
  const W = ATELIER_WINDOW;
  const pane = new Mesh(new BoxGeometry(W.w, W.h, 0.004), new MeshBasicMaterial({ color: 0xf2e3c4 }));
  pane.name = 'atelier-window';
  pane.position.set(W.x, W.y, W.z);
  g.add(pane);
  return g;
}

/** Pick marker: a flat ring where the hand's ray meets a real surface. */
export function pickRing(name: string): Mesh {
  const m = new Mesh(
    new RingGeometry(0.028, 0.04, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
  );
  paint((m.material as MeshBasicMaterial).color, 'pinch');
  m.name = name;
  m.renderOrder = 4;
  m.visible = false;
  return m;
}

/** The passenger: a small turned figure (cloak and head in one lathe, one draw call), 4 cm tall, feet at y = 0. */
export function passengerMesh(): Mesh {
  const p = [
    [0, 0], [0.007, 0], [0.0065, 0.004], [0.0045, 0.022], [0.0035, 0.026], [0.002, 0.0275],
    [0.0045, 0.03], [0.005, 0.034], [0.0042, 0.0375], [0.0022, 0.0395], [0, 0.04],
  ].map(([x, y]) => new Vector2(x, y));
  const mat = new MeshStandardMaterial({ roughness: 0.7 });
  paint(mat.color, 'passenger');
  const m = new Mesh(new LatheGeometry(p, 14), mat);
  m.name = 'passenger';
  m.visible = false;
  return m;
}

/**
 * The rebuild stone: a plain block with a turning arrow cut into its face (no text). Pinched, it
 * sets the same level up again. Origin at its centre, the arrow facing +z (the player).
 */
export function rebuildStone(stone: MeshStandardMaterial): Group {
  const g = new Group();
  g.name = 'rebuild';
  const block = new Mesh(prism([
    { x: -0.024, y: -0.016 }, { x: 0.024, y: -0.016 }, { x: 0.02, y: 0.016 }, { x: -0.02, y: 0.016 },
  ], 0.03), stone);
  block.name = 'rebuild-block';
  g.add(block);
  const icon = new MeshBasicMaterial();
  paint(icon.color, 'pinch');
  const arc = new Mesh(new TorusGeometry(0.0085, 0.0016, 6, 24, Math.PI * 1.5), icon);
  arc.position.z = 0.0155;
  arc.rotation.z = Math.PI * 0.25;
  g.add(arc);
  // Arrowhead at the arc's end, pointing along it.
  const head = new Mesh(new ConeGeometry(0.0034, 0.0055, 10), icon);
  const end = Math.PI * 0.25 + Math.PI * 1.5;
  head.position.set(Math.cos(end) * 0.0085, Math.sin(end) * 0.0085, 0.0155);
  head.rotation.z = end;
  g.add(head);
  g.visible = false;
  return g;
}

/**
 * Level markers, one instance per level: a solid little block for a solved level, a hollow
 * frame for an open one; locked levels are left out (scaled to zero). Two draw calls.
 */
export function levelMarkers(count: number): { filled: InstancedMesh; hollow: InstancedMesh } {
  const s = MARKER.size, h = 0.012, bar = 0.004;
  const mat = flatMaterial(0xffffff);
  const filled = new InstancedMesh(new BoxGeometry(s, h, s).translate(0, h / 2, 0), mat, count);
  const frame = boxes([
    { w: s, h, d: bar, x: 0, y: h / 2, z: (s - bar) / 2 },
    { w: s, h, d: bar, x: 0, y: h / 2, z: -(s - bar) / 2 },
    { w: bar, h, d: s - 2 * bar, x: (s - bar) / 2, y: h / 2, z: 0 },
    { w: bar, h, d: s - 2 * bar, x: -(s - bar) / 2, y: h / 2, z: 0 },
  ]);
  const hollow = new InstancedMesh(frame, mat, count);
  filled.name = 'markers-solved';
  hollow.name = 'markers-open';
  return { filled, hollow };
}

/** Marker of Today's Span: a round stone, unlike the square level markers. One draw call. */
export function dailyMarker(): Mesh {
  const r = MARKER.size * 0.58, h = 0.01;
  const m = new Mesh(new CylinderGeometry(r, r * 1.08, h, 20).translate(0, h / 2, 0), flatMaterial(0xffffff));
  m.name = 'marker-daily';
  return m;
}

/**
 * Share tablet of Today's Span: a small stone slab, origin at the middle of its foot, leaning back
 * by TABLET.lean. Its face carries up to `capacity` tiles (instances), one per stone of the arch in
 * ring order, coloured like the stones. No text. Two draw calls.
 */
export function shareTablet(stone: MeshStandardMaterial, capacity = 12): { group: Group; face: Group; tiles: InstancedMesh } {
  const { width: w, height: h, thickness: d, lean, tile } = TABLET;
  const group = new Group();
  group.name = 'share-tablet';
  const face = new Group();
  face.rotation.x = -lean;
  group.add(face);
  const slab = new Mesh(prism([{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }, { x: w / 2 - 0.004, y: h }, { x: -w / 2 + 0.004, y: h }], d), stone);
  slab.name = 'share-tablet-slab';
  face.add(slab);
  const tiles = new InstancedMesh(new BoxGeometry(tile, tile, 0.0025), flatMaterial(0xffffff), capacity);
  tiles.name = 'share-tablet-tiles';
  tiles.count = 0;
  tiles.position.z = d / 2 + 0.001;
  face.add(tiles);
  group.visible = false;
  return { group, face, tiles };
}

/**
 * The accessibility panel: a low stone slab with three icons on its top, no text. Gaze is an eye
 * (an almond rim and a pupil), one hand a flat open hand, high contrast a ring half filled. An icon
 * that is on is lit (pinch colour) and stands proud; one that is off is dark and flush. Origin at
 * the middle of the slab's foot; its top slopes up away from the player, facing them. Four draw calls.
 */
export function a11yPanel(stone: MeshStandardMaterial): {
  group: Group; top: Group; icons: Record<(typeof A11Y_ICONS)[number], Mesh>; on: MeshBasicMaterial; off: MeshBasicMaterial;
} {
  const { width: w, depth: d, height: h, lean, icon: r } = A11Y_PANEL;
  const group = new Group();
  group.name = 'a11y-panel';
  // A wedge: h tall at the front (+z), taller at the back, so its top faces the player.
  const rise = d * Math.tan(lean);
  const slab = new Mesh(prism([
    { x: -d / 2, y: 0 }, { x: d / 2, y: 0 }, { x: d / 2, y: h }, { x: -d / 2, y: h + rise },
  ], w, 0.002).rotateY(-Math.PI / 2), stone);
  slab.name = 'a11y-panel-slab';
  group.add(slab);
  const top = new Group(); // the sloped top face: icons lie in its x-z plane
  top.position.y = h + rise / 2;
  top.rotation.x = lean;
  group.add(top);
  const on = new MeshBasicMaterial();
  paint(on.color, 'pinch');
  const off = new MeshBasicMaterial();
  paint(off.color, 'background');
  const flat = (g: BufferGeometry) => g.rotateX(-Math.PI / 2); // drawn in x-y, laid on the top face
  const eye = weld([
    flat(new TorusGeometry(r, r * 0.13, 4, 28).scale(1, 0.55, 1)),
    flat(new CylinderGeometry(r * 0.32, r * 0.32, 0.0012, 16).rotateX(Math.PI / 2)),
  ]);
  const f = r * 0.2; // finger width
  const hand = flat(boxes([
    { w: r * 0.95, h: r * 0.9, d: 0.0012, x: 0, y: -r * 0.35, z: 0 },               // palm
    ...[-1.5, -0.5, 0.5, 1.5].map(k => ({ w: f, h: r * (k === -1.5 || k === 1.5 ? 0.7 : 0.85), d: 0.0012,
      x: k * f * 1.2, y: r * 0.45, z: 0 })),                                          // fingers
    { w: r * 0.55, h: f, d: 0.0012, x: -r * 0.62, y: -r * 0.15, z: 0 },             // thumb
  ]));
  const contrast = weld([
    flat(new TorusGeometry(r, r * 0.13, 4, 28)),
    flat(new CylinderGeometry(r, r, 0.0012, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2)),
  ]);
  const geos = { gaze: eye, oneHand: hand, highContrast: contrast };
  const icons = {} as Record<(typeof A11Y_ICONS)[number], Mesh>;
  A11Y_ICONS.forEach((k, i) => {
    const m = new Mesh(geos[k], off);
    const p = a11yIconSpot(i);
    m.position.set(p.x, p.y + 0.0007, p.z);
    m.name = `a11y-${k}`;
    top.add(m);
    icons[k] = m;
  });
  return { group, top, icons, on, off };
}

/** Non-indexed geometries (position, normal, uv) welded into one, so a model is one draw call. */
function weld(parts: BufferGeometry[]): BufferGeometry {
  const out: Record<string, number[]> = { position: [], normal: [], uv: [] };
  for (const g0 of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(out)) out[k].push(...(g.getAttribute(k).array as Float32Array));
    g.dispose();
    if (g !== g0) g0.dispose();
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(out.position, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(out.uv, 2));
  return geo;
}

/** The load a model is drawn for; a heavier one is drawn a little bigger (by the cube root of its mass). */
export const LOAD_BASE_KG = 0.5;

/**
 * A load that stands on an arch in world 3, origin at the middle of its foot, up +y, long side
 * along x (the arch). Tower: a squat stone tower with battlements, in the piers' stone. Bell: a cast
 * bell under a short beam, in bronze. Cart: a wooden cart on four wheels. No text; one draw call each.
 * Materials come from loadMaterials(), made once.
 */
export function loadMesh(kind: LoadKind, kg: number, mats: Record<LoadKind, MeshStandardMaterial>): Mesh {
  let geo: BufferGeometry;
  if (kind === 'tower') {
    const w = 0.024, h = 0.042, c = 0.006;
    const parts = [{ w, h, d: w, x: 0, y: h / 2, z: 0 }];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ w: c, h: c, d: c, x: x * (w - c) / 2, y: h + c / 2, z: z * (w - c) / 2 });
    geo = boxes(parts);
  } else if (kind === 'bell') {
    const p = [[0, 0.003], [0.012, 0.003], [0.0115, 0.006], [0.009, 0.012], [0.0075, 0.019], [0.0068, 0.024], [0.004, 0.027], [0, 0.0275]]
      .map(([x, y]) => new Vector2(x, y));
    const beam = boxes([
      { w: 0.032, h: 0.004, d: 0.006, x: 0, y: 0.031, z: 0 },
      { w: 0.003, h: 0.031, d: 0.006, x: -0.0145, y: 0.0155, z: 0 },
      { w: 0.003, h: 0.031, d: 0.006, x: 0.0145, y: 0.0155, z: 0 },
    ]);
    geo = weld([new LatheGeometry(p, 16), beam]);
  } else {
    const r = 0.0065;
    const body = boxes([{ w: 0.04, h: 0.012, d: 0.022, x: 0, y: r + 0.008, z: 0 }]);
    const wheels = [-1, 1].flatMap(x => [-1, 1].map(z => {
      const g = new CylinderGeometry(r, r, 0.004, 12);
      g.rotateX(Math.PI / 2);
      g.translate(x * 0.013, r, z * 0.011);
      return g;
    }));
    geo = weld([body, ...wheels]);
  }
  const k = Math.min(1.3, Math.max(0.8, Math.cbrt(kg / LOAD_BASE_KG)));
  geo.scale(k, k, k);
  const m = new Mesh(geo, mats[kind]);
  m.name = `load-${kind}`;
  return m;
}

/** The loads' materials: the piers' stone, bronze and cart timber (not the centering's, which fades out). */
export function loadMaterials(): Record<LoadKind, MeshStandardMaterial> {
  return { tower: flatMaterial('abutment'), bell: flatMaterial('bronze'), cart: woodMaterial('centering', 2) };
}

/**
 * A museum plinth with its copy (src/game/museum.ts), as one mesh: one draw call however many
 * stones. Each part is welded in with its palette colour as a vertex colour, so `material` is a
 * clone of the stone material with vertex colours on. recolorMuseumPiece() follows a palette change.
 */
export function museumPiece(parts: { geo: BufferGeometry; key: PaletteKey }[], material: MeshStandardMaterial): Mesh {
  const keys: { key: PaletteKey; start: number; count: number }[] = [];
  let start = 0;
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g !== p.geo) { p.geo.dispose(); p.geo = g; }
    const count = g.getAttribute('position').count;
    keys.push({ key: p.key, start, count });
    start += count;
  }
  const geo = weld(parts.map(p => p.geo));
  geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(start * 3), 3));
  const m = new Mesh(geo, material);
  m.name = 'museum-piece';
  m.userData.colorKeys = keys;
  recolorMuseumPiece(m);
  return m;
}

export function recolorMuseumPiece(m: Mesh): void {
  const attr = m.geometry.getAttribute('color') as Float32BufferAttribute;
  const c = new Color();
  for (const { key, start, count } of m.userData.colorKeys as { key: PaletteKey; start: number; count: number }[]) {
    c.setHex(COLORS[key]);
    for (let i = start; i < start + count; i++) attr.setXYZ(i, c.r, c.g, c.b);
  }
  attr.needsUpdate = true;
}

/** The museum's material: the tooled stone, coloured per vertex. */
export function museumMaterial(stone: MeshStandardMaterial): MeshStandardMaterial {
  const m = stone.clone();
  m.color.setHex(0xffffff);
  m.vertexColors = true;
  return m;
}

/**
 * The teaching hand of the first minute (src/systems/onboard.ts): a pale, see-through right hand,
 * palm down, fingers towards the arch (-z), its pinch point (thumb tip on index tip) at the origin.
 * Three meshes on one material: palm with the three curled fingers, and the index finger and thumb
 * on pivots at their knuckles, which open by rotating (`setGhostHandOpen`). Real hand scale.
 */
export function ghostHand(): { group: Group; material: MeshBasicMaterial; index: Group; thumb: Group } {
  const material = new MeshBasicMaterial({ color: 0xf4efe6, transparent: true, opacity: 0, depthWrite: false });
  const group = new Group();
  group.name = 'ghost-hand';
  group.visible = false;
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  // A capsule from `a` to `b` (radius r), as non-indexed positions.
  const bone = (a: Vector3, b: Vector3, r: number): BufferGeometry => {
    const d = b.clone().sub(a);
    const g = new CapsuleGeometry(r, Math.max(0.001, d.length() - 2 * r), 3, 8).toNonIndexed();
    g.applyQuaternion(q.setFromUnitVectors(up, d.normalize()));
    const m = a.clone().add(b).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    return g;
  };
  const merge = (parts: BufferGeometry[]): BufferGeometry => {
    const out: number[] = [];
    for (const p of parts) { const a = p.getAttribute('position').array; for (let i = 0; i < a.length; i++) out.push(a[i]); }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(out, 3));
    return g;
  };
  const palm = new BoxGeometry(0.075, 0.024, 0.085, 1, 1, 1).toNonIndexed();
  palm.rotateX(-0.25);
  palm.translate(0.012, 0.05, 0.105);
  // Middle, ring and little fingers curled under the palm.
  const curled = [0.004, 0.024, 0.042].map((x, i) =>
    bone(new Vector3(x, 0.045, 0.062), new Vector3(x + 0.002, 0.012 + 0.004 * i, 0.05 + 0.004 * i), 0.0085 - 0.0008 * i));
  const body = new Mesh(merge([palm, ...curled]), material);
  body.name = 'ghost-hand-palm';
  group.add(body);
  // Index and thumb: knuckle at the pivot, tip on the origin when closed.
  const finger = (name: string, knuckle: Vector3, r: number): Group => {
    const pivot = new Group();
    pivot.name = name;
    pivot.position.copy(knuckle);
    const m = new Mesh(bone(new Vector3(), knuckle.clone().negate(), r), material);
    m.name = `${name}-bone`;
    pivot.add(m);
    group.add(pivot);
    return pivot;
  };
  const index = finger('ghost-hand-index', new Vector3(-0.012, 0.047, 0.058), 0.0085);
  const thumb = finger('ghost-hand-thumb', new Vector3(-0.042, 0.03, 0.052), 0.0095);
  for (const m of [body, ...index.children, ...thumb.children] as Mesh[]) m.renderOrder = 5;
  return { group, material, index, thumb };
}

/** Open the ghost hand's pinch: 0 thumb on index, 1 about 5 cm apart. */
export function setGhostHandOpen(h: { index: Group; thumb: Group }, open: number): void {
  h.index.rotation.set(0.45 * open, 0, 0);
  h.thumb.rotation.set(0, 0.55 * open, -0.15 * open);
}

/**
 * Two engraved lines on a `width` × `height` (m) face: dark letters on a transparent canvas, drawn
 * in x-y facing +z, to lie on a stone face. Plain system serif, nothing fetched.
 */
export function engraving(lines: readonly string[], width: number, height: number): Mesh {
  const px = 2048;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * height) / width);
  const g = c.getContext('2d')!;
  const rows = lines.length;
  const size = Math.min(c.height / (rows + 0.9), 64);
  g.font = `${Math.round(size)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Cut letters: a light lower lip under a dark groove.
  lines.forEach((line, i) => {
    const y = c.height / 2 + (i - (rows - 1) / 2) * size * 1.25;
    g.fillStyle = 'rgba(255,248,235,0.45)';
    g.fillText(line, c.width / 2, y + 2, c.width * 0.94);
    g.fillStyle = 'rgba(40,30,22,0.92)';
    g.fillText(line, c.width / 2, y, c.width * 0.94);
  });
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.name = 'engraving';
  m.renderOrder = 2;
  return m;
}

/**
 * A monument level's plaque: a low stone wedge (PLAQUE) with the two lines of plaqueText cut into
 * its sloped top. Origin at the middle of its foot. Two draw calls.
 */
export function plaqueMesh(lines: readonly string[], stone: MeshStandardMaterial): Group {
  const { width: w, depth: d, height: h, lean } = PLAQUE;
  const group = new Group();
  group.name = 'monument-plaque';
  const rise = d * Math.tan(lean);
  const slab = new Mesh(prism([
    { x: -d / 2, y: 0 }, { x: d / 2, y: 0 }, { x: d / 2, y: h }, { x: -d / 2, y: h + rise },
  ], w, 0.002).rotateY(-Math.PI / 2), stone);
  slab.name = 'monument-plaque-slab';
  group.add(slab);
  const text = engraving(lines, w * 0.94, (d / Math.cos(lean)) * 0.8);
  text.position.y = h + rise / 2 + 0.0006;
  text.rotation.x = lean - Math.PI / 2;
  group.add(text);
  return group;
}

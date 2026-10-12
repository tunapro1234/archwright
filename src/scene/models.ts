// Procedural meshes and materials. Everything is built in code: no texture files, models or fonts.
import {
  BackSide, BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DataTexture, ExtrudeGeometry,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NoColorSpace, RepeatWrapping, RGBAFormat,
  ConeGeometry, CylinderGeometry, InstancedMesh, LatheGeometry, RingGeometry, Shape, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector2,
  Vector3,
} from '@iwsdk/core';
import type { Vec2 } from '../statics/index.js';
import type { LoadKind, Material } from '../game/arch-state.js';
import { ABUTMENT_HEIGHT, BOARD, CENTERING, MARKER } from './layout.js';
import { PALETTE } from './palette.js';
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
    color: 0xffffff, map, normalMap, normalScale: new Vector2(0.9, 0.9), roughness: 0.93, metalness: 0,
  });
}

/** The piers: the same tooled stone in a colour none of the playable stones has. */
export function abutmentMaterial(stone: MeshStandardMaterial): MeshStandardMaterial {
  const m = stone.clone();
  m.color.setHex(PALETTE.abutment);
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

/** Plank timber: the centering. Planks are ~3 cm wide, a tile covers 25 cm. */
export function woodMaterial(color: number = PALETTE.centering, repeat = 4): MeshStandardMaterial {
  const map = plankTexture(256);
  map.repeat.set(repeat, repeat);
  const bumpMap = map.clone();
  bumpMap.colorSpace = NoColorSpace;
  return new MeshStandardMaterial({ color, map, bumpMap, bumpScale: 1.5, roughness: 0.78, metalness: 0 });
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

/** A plain, finely grained surface: the board and the virtual desk (no planks, so not timber). */
export function flatMaterial(color: number): MeshStandardMaterial {
  const map = grainTexture(64, 0.88);
  map.repeat.set(8, 8);
  return new MeshStandardMaterial({ color, map, roughness: 0.85, metalness: 0 });
}

/** Wooden centering under the intrados, standing on the board, with a pull handle at the front. */
export function centeringMesh(top: Vec2[], depth: number, material: MeshStandardMaterial): Mesh {
  // Shrunk by a millimetre or two so it never z-fights with the stones resting on it.
  const inset = 0.0015;
  const half = top[top.length - 1].x;
  const k = 1 - inset / half;
  const shape = new Shape();
  shape.moveTo(half * k, -ABUTMENT_HEIGHT);
  for (let i = top.length - 1; i >= 0; i--) shape.lineTo(top[i].x * k, top[i].y - inset);
  shape.lineTo(-half * k, -ABUTMENT_HEIGHT);
  shape.closePath();
  const d = depth * 0.92;
  const body = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 1 });
  body.translate(0, 0, -d / 2);
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
  const mat = new MeshBasicMaterial({ color: PALETTE.thrust, transparent: true, opacity: 0, depthTest: true });
  const m = new Mesh(geo, mat);
  m.name = 'thrust-line';
  m.renderOrder = 2;
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
  ]), woodMaterial(PALETTE.desk, 2.5));
  desk.name = 'atelier-desk';
  g.add(desk);
  const room = new Mesh(new BoxGeometry(4.2, 2.8, 4.2), flatMaterial(PALETTE.room));
  (room.material as MeshStandardMaterial).side = BackSide;
  room.name = 'atelier-room';
  room.position.set(0, 1.4 - D.height, 0.6); // floor under the desk legs, the player inside
  g.add(room);
  return g;
}

/** Pick marker: a flat ring where the hand's ray meets a real surface. */
export function pickRing(name: string): Mesh {
  const m = new Mesh(
    new RingGeometry(0.028, 0.04, 32).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: PALETTE.pinch, transparent: true, opacity: 0.9, depthWrite: false }),
  );
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
  const m = new Mesh(new LatheGeometry(p, 14), new MeshStandardMaterial({ color: PALETTE.passenger, roughness: 0.7 }));
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
  const icon = new MeshBasicMaterial({ color: PALETTE.pinch });
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
  return { tower: flatMaterial(PALETTE.abutment), bell: flatMaterial(PALETTE.bronze), cart: woodMaterial(PALETTE.centering, 2) };
}

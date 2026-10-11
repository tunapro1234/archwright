// Procedural meshes and materials. Everything is built in code: no textures, models or fonts.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, Color, DataTexture, ExtrudeGeometry, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, RepeatWrapping, RGBAFormat, Shape, SRGBColorSpace, TubeGeometry, Vector3,
} from '@iwsdk/core';
import type { Vec2 } from '../statics/index.js';
import type { Material } from '../game/arch-state.js';
import { ABUTMENT_HEIGHT, BOARD, CENTERING } from './layout.js';

export const MATERIAL_COLOR: Record<Material, number> = { sandstone: 0xc9a074, tuff: 0xe0d6b8, basalt: 0x55565c };

/** A prism over `outline` (x-y), `depth` deep in z, centred on z = 0, with a slight bevel. */
export function prism(outline: Vec2[], depth: number, bevel = 0.0015): BufferGeometry {
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

// Deterministic value noise baked into a small tileable texture: grain for stone, streaks for wood.
function noiseTexture(size: number, streak: boolean): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
  };
  const smooth = (x: number, y: number, cell: number) => {
    const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const n = size / cell, fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const v = (i: number, j: number) => hash(((x0 + i) % n + n) % n, ((y0 + j) % n + n) % n);
    return (v(0, 0) * (1 - sx) + v(1, 0) * sx) * (1 - sy) + (v(0, 1) * (1 - sx) + v(1, 1) * sx) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = streak
        ? 0.55 * smooth(x, y * 8, 16) + 0.3 * smooth(x, y * 8, 4) + 0.15 * smooth(x, y, 2)
        : 0.5 * smooth(x, y, 16) + 0.3 * smooth(x, y, 8) + 0.2 * smooth(x, y, 2);
      const v = Math.round(255 * (0.78 + 0.22 * n));
      const o = 4 * (y * size + x);
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The one stone material: grain texture tinted per instance (sandstone, tuff, basalt). */
export function stoneMaterial(): MeshStandardMaterial {
  const map = noiseTexture(64, false);
  map.repeat.set(14, 14); // extrude UVs are in metres: ~7 cm per tile
  return new MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.93, metalness: 0 });
}

export function woodMaterial(color = 0xa8764a): MeshStandardMaterial {
  const map = noiseTexture(64, true);
  map.repeat.set(6, 6);
  return new MeshStandardMaterial({ color, map, roughness: 0.8, metalness: 0 });
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

/** The golden line of thrust: one tube through the joint points, just in front of the stones. */
export function thrustTube(points: Vec2[], z: number): Mesh {
  const pts = points.map(p => new Vector3(p.x, p.y, z));
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const geo = new TubeGeometry(curve, Math.max(24, pts.length * 6), 0.0022, 6, false);
  const mat = new MeshBasicMaterial({ color: new Color(1.0, 0.78, 0.25), transparent: true, opacity: 0, depthTest: true });
  const m = new Mesh(geo, mat);
  m.name = 'thrust-line';
  m.renderOrder = 2;
  return m;
}

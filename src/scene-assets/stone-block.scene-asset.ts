import {
  Box3,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
} from '@iwsdk/core';
import { voussoirOutline } from '../geometry/voussoir.js';

/**
 * One sandstone wedge (a keystone cut from a 15 cm ring), extruded 10 cm deep.
 * Origin sits at the centre of its bottom face so it rests on whatever surface
 * it is placed on. Deterministic: no randomness, no DOM, no World.
 */
function buildStoneBlock(): Mesh {
  const halfAngle = 0.13; // rad, about 7.5 degrees each side of the crown
  const outline = voussoirOutline({
    innerRadius: 0.15,
    thickness: 0.05,
    fromAngle: Math.PI / 2 - halfAngle,
    toAngle: Math.PI / 2 + halfAngle,
  });

  const shape = new Shape();
  shape.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i].x, outline[i].y);
  shape.closePath();

  const depth = 0.1;
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new Box3();
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.computeVertexNormals();

  const material = new MeshStandardMaterial({
    color: 0xc9a77c, // warm sandstone
    roughness: 0.92,
    metalness: 0,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'stone-block';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export const stoneBlock = buildStoneBlock();

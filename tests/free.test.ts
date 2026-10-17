// What a level load frees (src/scene/free.ts), on plain three objects: no renderer needed, the
// renderer frees GPU buffers when these objects fire 'dispose'.
import {
  BoxGeometry, CanvasTexture, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, type EventDispatcher,
} from 'three';
import { describe, expect, it } from 'vitest';
import { freeObjects } from '../src/scene/free.js';

const fired = (o: EventDispatcher<{ dispose: object }>) => {
  const n = { count: 0 };
  o.addEventListener('dispose', () => { n.count++; });
  return n;
};

describe('freeing a level', () => {
  it('a stone batch frees its instance buffers, not only its geometry', () => {
    const shared = new MeshBasicMaterial();
    const batch = new InstancedMesh(new BoxGeometry(), shared, 3);
    batch.setColorAt(0, new Color(0xff0000));
    const proxy = new Mesh(batch.geometry, shared);
    const instances = fired(batch), geometry = fired(batch.geometry);
    freeObjects([batch, proxy], new Set([shared]));
    expect(instances.count).toBe(1);
    expect(geometry.count).toBeGreaterThanOrEqual(1);
  });

  it('shared materials and their textures stay; own ones go, with every texture they hold', () => {
    const shared = new MeshBasicMaterial({ map: new CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement) });
    const own = new MeshBasicMaterial({ map: new CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement) });
    own.alphaMap = new CanvasTexture({ width: 1, height: 1 } as HTMLCanvasElement);
    const root = new Group().add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), own));
    const s = fired(shared), sm = fired(shared.map!), o = fired(own), om = fired(own.map!), oa = fired(own.alphaMap);
    freeObjects([root], new Set([shared]));
    expect([s.count, sm.count]).toEqual([0, 0]);
    expect([o.count, om.count, oa.count]).toEqual([1, 1, 1]);
  });
});

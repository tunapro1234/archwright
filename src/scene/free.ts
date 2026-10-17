// Freeing what a level built, on the GPU. IWSDK's entity.dispose() frees geometry and materials but
// never calls InstancedMesh.dispose(), and in three (r181, WebGLObjects) only that frees the instance
// matrix and colour buffers: every stone batch left two live WebGL buffers on each level load. It
// also frees the shared materials and their textures, which the next level then uploads and compiles
// again. So level entities are disposed without their resources, and this frees them instead.
import type { BufferGeometry, Material, Object3D, Texture } from '@iwsdk/core';

type Drawable = Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; isInstancedMesh?: boolean; dispose?: () => void };

/** Free the geometry, the own materials (with their textures) and the instance buffers of every
 *  mesh under roots; materials in keep stay alive. Freeing the same geometry twice is harmless. */
export function freeObjects(roots: Iterable<Object3D>, keep: ReadonlySet<Material>): void {
  for (const root of roots) root.traverse(o => {
    const d = o as Drawable;
    if (!d.geometry) return;
    d.geometry.dispose();
    if (d.isInstancedMesh) d.dispose!();
    for (const m of Array.isArray(d.material) ? d.material : d.material ? [d.material] : []) {
      if (keep.has(m)) continue;
      for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose();
      m.dispose();
    }
  });
}

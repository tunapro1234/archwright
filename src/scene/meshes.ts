// What the meshes look like, as plain data: importable without three.js (Node tests read it).
// The builders that turn it into geometry and materials are in models.ts.
import type { Material } from '../game/arch-state.js';
import { PALETTE } from './palette.js';

/** Per-instance stone tint, straight from the palette (the one colour source). */
export const MATERIAL_COLOR: Record<Material, number> = {
  sandstone: PALETTE.sandstone, tuff: PALETTE.tuff, basalt: PALETTE.basalt,
};

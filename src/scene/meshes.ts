// What the meshes look like, as plain data: importable without three.js (Node tests read it).
// The builders that turn it into geometry and materials are in models.ts.
import type { Material } from '../game/arch-state.js';
import { COLORS } from './palette.js';

/**
 * Per-instance stone tint, straight from the palette (the one colour source): read through to
 * COLORS, so it follows the high-contrast palette when that is on (PALETTE otherwise).
 */
export const MATERIAL_COLOR: Readonly<Record<Material, number>> = {
  get sandstone() { return COLORS.sandstone; },
  get tuff() { return COLORS.tuff; },
  get basalt() { return COLORS.basalt; },
};

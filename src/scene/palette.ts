// The one source of colour (0xRRGGBB, sRGB). Stones, the wooden centering, the desk and the line
// of thrust must tell apart without words, also under colour blindness: uretim/kabul/okunurluk.kabul.ts
// checks CIE ΔE76 between them, with and without a Machado 2009 protan/deutan/tritan simulation,
// and a luminance ratio between the three stones. Colour is never the only cue: stones carry
// chisel marks and chamfered edges, the centering planks and grain.
// HIGH_CONTRAST is the accessibility mode's palette (src/game/a11y.ts): the same keys, pulled far
// apart (the same test with thresholds about 1.6 times higher, `okunurluk.kabul.ts yuksek`).
// The scene is painted from COLORS, which holds one of the two; usePalette switches it live.
export const PALETTE = {
  /** Muted warm ochre, mid lightness: a dressed sandstone, not an orange. */
  sandstone: 0xb48b60,
  /** Pale grey-cream, the lightest stone. */
  tuff: 0xe6dfcc,
  /** Dark grey, the darkest stone. */
  basalt: 0x3b3d42,
  /** Dark red-brown timber. */
  centering: 0x7a2e1c,
  /** The virtual desk outside passthrough: cool slate. */
  desk: 0x5f6e7c,
  /** Cyan line of thrust: off the warm-to-grey axis every stone lies on. */
  thrust: 0x3fd6e8,
  /** The line of thrust of an arch that falls, with its cracks: hot orange, warm where the holding line is cold. */
  thrustFail: 0xff6a00,
  /** The board the arch is built on: light cool grey, so dark and pale stones both stand out on it. */
  board: 0x8d969e,
  /** The two piers (cut ashlar) and the stone props: a warm grey limestone, none of the three playable stones. */
  abutment: 0x80786b,
  /** Opaque VR (atelier) background. */
  background: 0x2b2e33,
  /** Walls and floor of the atelier (opaque VR): dim warm plaster, behind everything else. */
  room: 0x4b4640,
  /** The atelier's desk (opaque VR): warm walnut, darker than the sandstone and browner than the centering. */
  workbench: 0x6e5340,
  /** The passenger who walks over a finished arch: deep blue, unlike any stone or the timber. */
  passenger: 0x2f5d9e,
  /** The bell that stands on an arch in world 3: dark verdigris bronze, off every stone and the timber. */
  bronze: 0x4f6b5a,
  /** Pinch cursor while pinching; also the icons (rebuild, current level marker). */
  pinch: 0xffc94a,
} as const;

export type PaletteKey = keyof typeof PALETTE;
export type Palette = { readonly [K in PaletteKey]: number };

/**
 * Accessibility mode: three stones a step apart in lightness (near-white, orange, near-black),
 * violet timber and a navy desk that are no stone's colour, and a sky-blue line of thrust.
 * Unnatural on purpose; legibility first.
 */
export const HIGH_CONTRAST: Palette = {
  sandstone: 0xc8641a,
  tuff: 0xffffff,
  basalt: 0x141414,
  centering: 0x9b30ff,
  desk: 0x1f3a7a,
  thrust: 0x00b0ff,
  /** Deep amber, between this palette's orange sandstone and its yellow pinch cursor: red would merge with that sandstone
   *  for a deuteranope, and the yellow of the old 0xffd400 with the cursor. */
  thrustFail: 0xffbe19,
  /** Mid grey: white, orange and black stones all stand off it. */
  board: 0x5c5c5c,
  abutment: 0x9e9e9e,
  background: 0x000000,
  room: 0x262626,
  workbench: 0x1f3a7a,
  passenger: 0xff2d95,
  bronze: 0x2e8b57,
  pinch: 0xffeb00,
};

/** The colours the scene is painted with now: PALETTE until usePalette says otherwise. */
export const COLORS: Record<PaletteKey, number> = { ...PALETTE };

interface Paintable { setHex(hex: number): unknown }
const painted: { color: Paintable; key: PaletteKey }[] = [];
const repaints: (() => void)[] = [];

/** Paints `color` (a three.js Color) from COLORS[key] now and again whenever the palette changes. */
export function paint<T extends Paintable>(color: T, key: PaletteKey): T {
  color.setHex(COLORS[key]);
  painted.push({ color, key });
  return color;
}

/** Calls `f` after every palette change, for colours paint() cannot hold (per-instance colours). */
export function onRepaint(f: () => void): void {
  repaints.push(f);
}

/** Switches the scene to `p`: COLORS, every painted colour and every onRepaint callback. */
export function usePalette(p: Palette): void {
  let same = true;
  for (const k of Object.keys(COLORS) as PaletteKey[]) if (COLORS[k] !== p[k]) { same = false; COLORS[k] = p[k]; }
  if (same) return;
  for (const { color, key } of painted) color.setHex(COLORS[key]);
  for (const f of repaints) f();
}

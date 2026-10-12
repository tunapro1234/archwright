// The one source of colour (0xRRGGBB, sRGB). Stones, the wooden centering, the desk and the line
// of thrust must tell apart without words, also under colour blindness: uretim/kabul/okunurluk.kabul.ts
// checks CIE ΔE76 between them, with and without a Machado 2009 protan/deutan/tritan simulation,
// and a luminance ratio between the three stones. Colour is never the only cue: stones carry
// chisel marks and chamfered edges, the centering planks and grain.
export const PALETTE = {
  /** Warm ochre, mid lightness. */
  sandstone: 0xc98f4a,
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
  /** The board the arch is built on: light cool grey, so dark and pale stones both stand out on it. */
  board: 0x8d969e,
  /** The two piers: a weathered stone that is none of the three playable ones. */
  abutment: 0xa08468,
  /** Opaque VR (atelier) background. */
  background: 0x2b2e33,
  /** Walls and floor of the atelier (opaque VR): dim warm plaster, behind everything else. */
  room: 0x4b4640,
  /** The passenger who walks over a finished arch: deep blue, unlike any stone or the timber. */
  passenger: 0x2f5d9e,
  /** The bell that stands on an arch in world 3: dark verdigris bronze, off every stone and the timber. */
  bronze: 0x4f6b5a,
  /** Pinch cursor while pinching; also the icons (rebuild, current level marker). */
  pinch: 0xffc94a,
} as const;

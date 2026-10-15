// Same origin only. Three libraries in the bundle name another origin: the XR input layer
// (@iwsdk/xr-input) fetches controller and hand models from the WebXR input profiles on jsDelivr,
// IWSDK's glTF loader points its Draco and KTX2 decoders at unpkg, and the UI kit's Avatar defaults
// to a DiceBear picture. Here is what we do instead, as plain data so Node tests check it:
//
// - The input profiles a Quest reports, and the hand, are copied into public/input-profiles/ (MIT,
//   ASSETS.md). A model request resolves through its profile.json, as the profiles are meant to
//   be read, to a model file next to it on this origin. Any other profile gets no model.
// - Draco and KTX2 are not used: no asset here is compressed that way (the profile models were
//   checked), so no decoder is shipped and the decoder path points into this site, not unpkg.
// - Avatar is never drawn; its default picture becomes an empty string.
// - The emulator's synthetic room (?emulator=1&room=office_small, @iwer/sem, development only): its
//   room file is copied into public/emulator/rooms/ (MIT, ASSETS.md) and handed to the module with
//   loadEnvironment. The module's own room loader is cut off: its bundled rooms would ship as 4.5 MB
//   of chunks, and its UMD branch fetches them from unpkg; that address now points into this site.
//
// SAME_ORIGIN_REWRITES are applied to those library files at build time (vite.config.ts), so the
// built page does not even contain the other hosts; the build fails if one is left.

/** Profiles copied into public/input-profiles/: Quest controllers (3, Pro, 2, 1) and tracked hands. */
export const LOCAL_PROFILES = [
  'meta-quest-touch-plus', 'meta-quest-touch-plus-v2', 'meta-quest-touch-pro', 'oculus-touch-v3', 'oculus-touch-v2', 'generic-hand',
] as const;
export type LocalProfile = (typeof LOCAL_PROFILES)[number];

/** Where the copied profiles are served, under the site's base path. */
export const PROFILES_DIR = 'input-profiles';

/** Synthetic rooms of the IWER emulator copied into public/emulator/rooms/, for ?emulator=1&room=<name>. */
export const EMULATOR_ROOMS = ['office_small'] as const;
export type EmulatorRoom = (typeof EMULATOR_ROOMS)[number];

/** Where the copied rooms are served, under the site's base path. */
export const ROOMS_DIR = 'emulator/rooms';

/** The room a ?room= value names, or null for none or one we do not serve. */
export function emulatorRoom(param: string | null): EmulatorRoom | null {
  return (EMULATOR_ROOMS as readonly string[]).includes(param ?? '') ? (param as EmulatorRoom) : null;
}

/** Hosts the built page must not name (checked on every build). */
export const FOREIGN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'api.dicebear.com'] as const;

/** Exact source text in each library file and what replaces it at build time (`base` = Vite's base path). */
export function sameOriginRewrites(base: string): { file: RegExp; from: string; to: string }[] {
  return [
    {
      file: /@iwsdk[\\/]xr-input[\\/]dist[\\/]gamepad[\\/]input-profiles\.js$/,
      from: "'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles'",
      to: JSON.stringify(base + PROFILES_DIR),
    },
    {
      file: /@iwsdk[\\/]core[\\/]dist[\\/]asset[\\/]loaders[\\/]gltf-loader\.js$/,
      from: '`https://unpkg.com/three@0.${REVISION}.0`',
      to: JSON.stringify(base + 'no-decoders'),
    },
    {
      file: /@pmndrs[\\/]uikit-horizon[\\/]dist[\\/]avatar[\\/]index\.js$/,
      from: '`https://api.dicebear.com/9.x/lorelei/png?seed=${Math.random()}`',
      to: "''",
    },
    {
      // The emulator room module's built-in rooms: never loaded here (we pass our copy to
      // loadEnvironment), so their import table goes and its 4.5 MB of room files stay out of the build.
      file: /@iwer[\\/]sem[\\/]lib[\\/]src[\\/]sem\.js$/,
      from: "import { Environments } from './registry.js';",
      to: 'const Environments = {};',
    },
    {
      // ...and its UMD fallback, which would fetch a room from unpkg, looks in this site's rooms folder.
      file: /@iwer[\\/]sem[\\/]lib[\\/]src[\\/]sem\.js$/,
      from: '`https://www.unpkg.com/@iwer/sem@${VERSION}/captures/${envId}.json`',
      to: '`' + base + ROOMS_DIR + '/${envId}.json`',
    },
  ];
}

/**
 * A controller or hand model the input layer asks for (from jsDelivr in development, from this
 * site once built): its profile and handedness, or null when it is not one we serve.
 */
export function profileModel(url: string): { profile: LocalProfile; hand: 'left' | 'right' } | null {
  const m = /(?:\/@webxr-input-profiles\/assets@[^/]+\/dist\/profiles|\/input-profiles)\/([a-z0-9-]+)\/(left|right)\.glb$/.exec(url);
  if (!m || !(LOCAL_PROFILES as readonly string[]).includes(m[1])) return null;
  return { profile: m[1] as LocalProfile, hand: m[2] as 'left' | 'right' };
}

/** The model file a profile.json names for a hand, or null if it names none (or not a plain file name). */
export function modelFile(profileJson: unknown, hand: 'left' | 'right'): string | null {
  const layouts = (profileJson as { layouts?: Record<string, { assetPath?: unknown }> } | null)?.layouts;
  const file = layouts?.[hand]?.assetPath;
  return typeof file === 'string' && /^[a-z0-9-]+\.glb$/.test(file) ? file : null;
}

/** True when `url` leaves this origin (relative and same-origin URLs, data: and blob: stay). */
export function isForeign(url: string, origin: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(data|blob):/i.test(url) && !url.startsWith(origin + '/') && url !== origin;
}

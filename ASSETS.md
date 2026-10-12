# Assets

Every visual and every sound in Archwright is generated in code at runtime: stone and wood meshes, the atelier room and desk, their grain, chisel-mark and plank
textures in `src/scene/models.ts` (colours in `src/scene/palette.ts`), the stone notes, the held arch's chord, the centering's creak and the collapse with the Web Audio API in `src/audio/synth.ts` (from the data in `src/audio/music.ts`; no recordings). The only
third-party files are the controller and hand models below, used by the XR input layer, and the page loads nothing from another
origin (README.md says how, under "Nothing is fetched from another origin").

| File | What | Author / source | License |
|---|---|---|---|
| `public/input-profiles/<profile>/profile.json`, `left.glb`, `right.glb` for `meta-quest-touch-plus`, `meta-quest-touch-plus-v2`, `meta-quest-touch-pro`, `oculus-touch-v3`, `oculus-touch-v2`, `generic-hand` | Controller and hand profiles and models for the XR input layer, loaded only in an XR session | [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles), npm `@webxr-input-profiles/assets` 1.0.20, unmodified | MIT, `public/input-profiles/LICENSE.md` |

Not used, so not shipped: the Draco decoder and the KTX2 (Basis Universal) transcoder, both Apache-2.0 (no model here is
compressed with them), and the UI kit's DiceBear avatar.

import { AssetManager, SessionMode, World, type Mesh } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ArchRuntime, type Hook } from './game/runtime.js';
import { watchBoot } from './game/boot-overlay.js';
import { HandSystem } from './systems/hands.js';
import { GrabSnapSystem } from './systems/grab-snap.js';
import { SpotHoverSystem } from './systems/spot-hover.js';
import { CenteringSystem } from './systems/centering.js';
import { StaticsSystem } from './systems/statics.js';
import { CollapseSystem } from './systems/collapse.js';
import { PerfEndSystem, PerfStartSystem, StoneRenderSystem } from './systems/render.js';
import { SurfaceSystem } from './systems/surface.js';
import { AutotestSystem } from './systems/autotest.js';
import { GameLoopSystem } from './systems/loop.js';
import { MuseumSystem } from './systems/museum.js';
import { DesktopSystem } from './systems/desktop.js';
import { LoadSystem } from './systems/loads.js';
import { A11ySystem } from './systems/a11y.js';
import { GazeSystem } from './systems/gaze.js';
import { OnboardSystem } from './systems/onboard.js';
import { DebugOverlaySystem } from './systems/debug.js';
import { installPause } from './systems/pause.js';
import { installXREntry, xrError } from './systems/xr-entry.js';
import { browserStorage, loadProgress } from './game/progress.js';
import { isForeign, modelFile, PROFILES_DIR, profileModel } from './net/local-assets.js';

// The XR session, its optional features and the scene all come from iwsdk.config.json.
// Only `local-floor` (falling back to `local`) is used as the reference space; every
// other WebXR feature is optional so the experience starts on any Quest setup.

const params = new URLSearchParams(location.search);

// Same origin only (src/net/local-assets.ts). The input layer asks for controller and hand models
// by their WebXR input profile; a profile we serve resolves through its own profile.json to the
// model beside it on this site. In passthrough the player sees their real hands, so no hand model;
// a controller keeps its model there (it shows where the ray starts). Anything else from another
// origin is refused, and the input stays tracked without a visual.
const BASE = import.meta.env.BASE_URL;
const loadGLTF = AssetManager.loadGLTF.bind(AssetManager);
const profiles = new Map<string, Promise<unknown>>();
let passthrough = (): boolean => false;
AssetManager.loadGLTF = (url: string, key?: string) => {
  const model = profileModel(url);
  if (model) {
    if (model.profile === 'generic-hand' && passthrough()) return Promise.reject(new Error('passthrough: real hands are in view'));
    const dir = `${BASE}${PROFILES_DIR}/${model.profile}/`;
    let json = profiles.get(model.profile);
    if (!json) {
      json = fetch(dir + 'profile.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${dir}profile.json`))));
      profiles.set(model.profile, json);
    }
    return json.then(p => {
      const file = modelFile(p, model.hand);
      return file ? loadGLTF(dir + file, key) : Promise.reject(new Error(`${model.profile}: no ${model.hand} model`));
    });
  }
  return isForeign(url, location.origin) ? Promise.reject(new Error(`remote asset blocked: ${url}`)) : loadGLTF(url, key);
};

/** The mode each XR session was asked for (WebXR does not report it), filled by watchSessionModes. */
const sessionModes = new WeakMap<XRSession, XRSessionMode>();

/** Note the mode of every session the page requests or offers, for __archwright.xr. A request or offer the browser
 *  turns down (a button pressed while IWSDK's offer is pending, an offer closed) settles with no session, which IWSDK
 *  takes as nothing to adopt; its message goes to __archwright.xrEntry.error instead of the console. */
function watchSessionModes(xr: XRSystem): void {
  for (const k of ['requestSession', 'offerSession'] as const) {
    const f = (xr as unknown as Record<string, unknown>)[k];
    if (typeof f !== 'function') continue;
    (xr as unknown as Record<string, unknown>)[k] = (mode: XRSessionMode, init?: XRSessionInit) =>
      (f.call(xr, mode, init) as Promise<XRSession>).then(
        s => { sessionModes.set(s, mode); return s; },
        e => { xrError(e); return undefined; },
      );
  }
}

async function main(): Promise<void> {
  // ?emulator=1: IWER (Meta's WebXR emulator) so a desktop browser offers an XR session, with &room= and &head=
  // (src/emulator/emulator.ts). Loaded on demand, so it never ships in the normal first load.
  const emu = params.get('emulator') === '1' ? await import('./emulator/emulator.js') : null;
  const started = emu ? await emu.startEmulator(params, BASE) : null;
  const emulator = started?.device;
  const room = started?.room ?? null;
  if (navigator.xr) watchSessionModes(navigator.xr);

  // iwsdk.config.json enables physics so the build keeps Havok, but the first frame does not need it:
  // CollapseSystem registers it once the board is up and the page is idle (or at the first stone), and
  // Havok's WASM loads only then.
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, {
    ...projectOptions,
    features: { ...projectOptions.features, physics: false },
  });

  const arch = new ArchRuntime(world);
  world.globals.arch = arch;
  if (emulator) {
    world.globals.emulator = emulator;
    arch.hook.emulator = emu!.emulatorHook(emulator, world);
  }
  arch.hook.xr = { mode: null, features: [], inputs: [], room, head: null, frames: 0 };
  passthrough = () => {
    const s = world.renderer.xr.getSession();
    return !!s && s.environmentBlendMode !== 'opaque';
  };
  world.renderer.xr.addEventListener('sessionstart', () => {
    const s = world.renderer.xr.getSession();
    if (!s) return;
    // A session nobody asked for here (a browser grant): opaque means VR, see-through means AR.
    const mode = sessionModes.get(s) ?? (s.environmentBlendMode === 'opaque' ? 'immersive-vr' : 'immersive-ar');
    // Each input source by its most specific profile ('meta-quest-touch-plus', 'generic-hand', ...).
    const inputs = () => [...s.inputSources].map(i => i.profiles[0] ?? 'unknown');
    // The head from the first XR frame on (SurfaceSystem); until then the emulated headset's own pose, if any.
    const head = emulator ? emu!.headPose(emulator) : null;
    arch.hook.xr = { mode: mode === 'inline' ? null : mode, features: [...(s.enabledFeatures ?? [])], inputs: inputs(), room, head, frames: 0 };
    s.addEventListener('inputsourceschange', () => { if (arch.hook.xr) arch.hook.xr.inputs = inputs(); });
  });
  // The ended session's XR frame count stays until the next one starts.
  world.renderer.xr.addEventListener('sessionend', () => {
    arch.hook.xr = { mode: null, features: [], inputs: [], room, head: null, frames: arch.hook.xr?.frames ?? 0 };
  });
  // Every system that runs game time; drawing (StoneRenderSystem), the performance numbers and the overlay go on through a pause.
  const game: unknown[] = [
    HandSystem, AutotestSystem, SurfaceSystem, A11ySystem, DesktopSystem, GazeSystem, GrabSnapSystem, SpotHoverSystem, CenteringSystem,
    StaticsSystem, CollapseSystem, GameLoopSystem, OnboardSystem, MuseumSystem, LoadSystem,
  ];
  world
    .registerSystem(PerfStartSystem, { priority: -100 })
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(AutotestSystem, { priority: 1 })
    .registerSystem(SurfaceSystem, { priority: 5 })
    .registerSystem(A11ySystem, { priority: 8 })
    .registerSystem(DesktopSystem, { priority: 9 })
    .registerSystem(GazeSystem, { priority: 9.5 })
    .registerSystem(GrabSnapSystem, { priority: 10 })
    .registerSystem(SpotHoverSystem, { priority: 10.5 })
    .registerSystem(CenteringSystem, { priority: 11 })
    .registerSystem(StaticsSystem, { priority: 12 })
    .registerSystem(CollapseSystem, { priority: 13 })
    .registerSystem(GameLoopSystem, { priority: 14 })
    .registerSystem(OnboardSystem, { priority: 14.5 })
    .registerSystem(MuseumSystem, { priority: 15 })
    .registerSystem(StoneRenderSystem, { priority: 20 })
    .registerSystem(LoadSystem, { priority: 21 })
    .registerSystem(DebugOverlaySystem, { priority: 999 })
    .registerSystem(PerfEndSystem, { priority: 1000 });
  // ?emulator=1: an input sent somewhere by __archwright.emulator.reach stays there (src/emulator/emulator.ts).
  if (emulator) {
    world.registerSystem(emu!.ReachSystem, { priority: 0.25 });
    game.push(emu!.ReachSystem);
  }
  // ?emulator=1&handplay=solution|trap: the emulated right hand plays the level, read by the game through its
  // hand joints like any hand (src/systems/handplay.ts). Emulator only, loaded on demand, before the session
  // starts so the emulated headset comes up with hands instead of controllers.
  if (emulator && params.get('handplay')) {
    const { HandPlaySystem } = await import('./systems/handplay.js');
    world.registerSystem(HandPlaySystem, { priority: 0.5 });
    game.push(HandPlaySystem);
  }
  // Clean pause: these and Havok stop under the system menu, with the headset off or in a hidden tab (src/systems/pause.ts).
  installPause(world, arch, game);
  // "Enter AR" / "Enter VR" on the page, for when the browser's offer does not show or is closed (src/systems/xr-entry.ts).
  installXREntry(world, arch);
  // __archwright.scene(): what the scene holds, walked only when asked (for the XR session cycle check).
  arch.hook.scene = () => {
    let boards = 0, meshes = 0, site = 0;
    world.scene.traverse(o => {
      if (o.name === 'board') boards++;
      if ((o as Mesh).isMesh) meshes++;
    });
    arch.site.traverse(o => { if (o !== arch.site) site++; });
    return { boards, meshes, site };
  };

  // ?autotest, then ?level=, then wherever the saved progress left off.
  const autotest = params.get('autotest')?.split(';')[0]?.split(':')[0] ?? null;
  arch.load(ArchRuntime.levelById(autotest ?? params.get('level') ?? loadProgress(browserStorage()).current));

  // ?emulator=1&autoxr=ar|vr: the page enters the emulated session by itself, for the XR smoke test.
  // Only with the emulator: on a real headset a session always starts from the player.
  const autoxr = AUTOXR[params.get('autoxr') ?? ''];
  if (params.get('emulator') === '1' && autoxr) world.launchXR({ sessionMode: autoxr });
}

const AUTOXR: Record<string, SessionMode> = { ar: SessionMode.ImmersiveAR, vr: SessionMode.ImmersiveVR };

// index.html's inline "Loading…" overlay goes once the first level is up (src/game/boot-overlay.ts); the hook
// appears only after World.create, so it is read through window each frame.
watchBoot(
  { get state() { return (window as unknown as { __archwright?: Hook }).__archwright?.state; } },
  document,
  f => requestAnimationFrame(f),
  window,
);
void main();

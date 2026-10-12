import { AssetManager, SessionMode, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ArchRuntime } from './game/runtime.js';
import { HandSystem } from './systems/hands.js';
import { GrabSnapSystem } from './systems/grab-snap.js';
import { CenteringSystem } from './systems/centering.js';
import { StaticsSystem } from './systems/statics.js';
import { CollapseSystem } from './systems/collapse.js';
import { PerfEndSystem, PerfStartSystem, StoneRenderSystem } from './systems/render.js';
import { SurfaceSystem } from './systems/surface.js';
import { AutotestSystem } from './systems/autotest.js';
import { GameLoopSystem } from './systems/loop.js';
import { DesktopSystem } from './systems/desktop.js';
import { browserStorage, loadProgress } from './game/progress.js';

// The XR session, its optional features and the scene all come from iwsdk.config.json.
// Only `local-floor` (falling back to `local`) is used as the reference space; every
// other WebXR feature is optional so the experience starts on any Quest setup.

const params = new URLSearchParams(location.search);

// Same-origin only: the input layer would otherwise fetch controller and hand models from a CDN.
// In passthrough the player sees their real hands and controllers, so no model is loaded at all.
const loadGLTF = AssetManager.loadGLTF.bind(AssetManager);
AssetManager.loadGLTF = (url: string, key?: string) =>
  /^https?:\/\//.test(url) && !url.startsWith(location.origin)
    ? Promise.reject(new Error(`remote asset blocked: ${url}`))
    : loadGLTF(url, key);

/** The mode each XR session was asked for (WebXR does not report it), filled by watchSessionModes. */
const sessionModes = new WeakMap<XRSession, XRSessionMode>();

/** Note the mode of every session the page requests or offers, for __archwright.xr. */
function watchSessionModes(xr: XRSystem): void {
  for (const k of ['requestSession', 'offerSession'] as const) {
    const f = (xr as unknown as Record<string, unknown>)[k];
    if (typeof f !== 'function') continue;
    (xr as unknown as Record<string, unknown>)[k] = (mode: XRSessionMode, init?: XRSessionInit) =>
      (f.call(xr, mode, init) as Promise<XRSession>).then(s => { sessionModes.set(s, mode); return s; });
  }
}

async function main(): Promise<void> {
  // ?emulator=1: install IWER (Meta's WebXR emulator) so a desktop browser offers an XR session.
  // Loaded on demand, so it never ships in the normal first load.
  if (params.get('emulator') === '1') {
    const { XRDevice, metaQuest3 } = await import('iwer');
    const device = new XRDevice(metaQuest3);
    // Chromium exposes its own navigator.xr even without a headset; replace it with the emulator.
    device.installRuntime({ forceInstall: true });
    device.position.set(0, 1.15, 0.05);
  }
  if (navigator.xr) watchSessionModes(navigator.xr);

  // iwsdk.config.json enables physics so the build keeps Havok, but it is not needed until the
  // first stone goes down: CollapseSystem registers it then, and Havok's WASM loads only at that point.
  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, {
    ...projectOptions,
    features: { ...projectOptions.features, physics: false },
  });

  const arch = new ArchRuntime(world);
  world.globals.arch = arch;
  arch.hook.xr = { mode: null, features: [] };
  world.renderer.xr.addEventListener('sessionstart', () => {
    const s = world.renderer.xr.getSession();
    if (!s) return;
    // A session nobody asked for here (a browser grant): opaque means VR, see-through means AR.
    const mode = sessionModes.get(s) ?? (s.environmentBlendMode === 'opaque' ? 'immersive-vr' : 'immersive-ar');
    arch.hook.xr = { mode: mode === 'inline' ? null : mode, features: [...(s.enabledFeatures ?? [])] };
  });
  world.renderer.xr.addEventListener('sessionend', () => { arch.hook.xr = { mode: null, features: [] }; });
  world
    .registerSystem(PerfStartSystem, { priority: -100 })
    .registerSystem(HandSystem, { priority: 0 })
    .registerSystem(AutotestSystem, { priority: 1 })
    .registerSystem(SurfaceSystem, { priority: 5 })
    .registerSystem(DesktopSystem, { priority: 9 })
    .registerSystem(GrabSnapSystem, { priority: 10 })
    .registerSystem(CenteringSystem, { priority: 11 })
    .registerSystem(StaticsSystem, { priority: 12 })
    .registerSystem(CollapseSystem, { priority: 13 })
    .registerSystem(GameLoopSystem, { priority: 14 })
    .registerSystem(StoneRenderSystem, { priority: 20 })
    .registerSystem(PerfEndSystem, { priority: 1000 });

  // ?autotest, then ?level=, then wherever the saved progress left off.
  const autotest = params.get('autotest')?.split(';')[0]?.split(':')[0] ?? null;
  arch.load(ArchRuntime.levelById(autotest ?? params.get('level') ?? loadProgress(browserStorage()).current));

  // ?emulator=1&autoxr=ar|vr: the page enters the emulated session by itself, for the XR smoke test.
  // Only with the emulator: on a real headset a session always starts from the player.
  const autoxr = AUTOXR[params.get('autoxr') ?? ''];
  if (params.get('emulator') === '1' && autoxr) world.launchXR({ sessionMode: autoxr });
}

const AUTOXR: Record<string, SessionMode> = { ar: SessionMode.ImmersiveAR, vr: SessionMode.ImmersiveVR };

void main();

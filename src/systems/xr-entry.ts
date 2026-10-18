// The page's own way into XR (src/game/xr-entry.ts): IWSDK offers the session to the browser, and if that offer does
// not show or the player closes it, "Enter AR" and "Enter VR" buttons at the bottom of the page request it instead.
// They are drawn only for what navigator.xr says it supports (none on a desktop without a headset, so the desktop view
// is as before), hide while a session runs and come back when it ends. A request the browser turns down (one that
// clashes with the pending offer, say) does not reach the console: its message goes to __archwright.xrEntry.error.
import { SessionMode, type World } from '@iwsdk/core';
import type { ArchRuntime, Hook } from '../game/runtime.js';
import { xrButtons, type XRButton } from '../game/xr-entry.js';

let hook: Hook | null = null;
let early: string | null = null;

/** Note a refused session request or offer (src/index.ts catches them) for __archwright.xrEntry.error. */
export function xrError(e: unknown): void {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (hook) hook.xrEntry.error = m;
  else early = m;
}

const MODES: Record<XRButton, SessionMode> = { ar: SessionMode.ImmersiveAR, vr: SessionMode.ImmersiveVR };
const LABEL: Record<XRButton, [string, string]> = {
  ar: ['Enter AR', 'Enter augmented reality: play on your real table'],
  vr: ['Enter VR', 'Enter virtual reality: play in the workshop'],
};

const CSS = `
#archwright-xr-entry { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; gap: 12px; z-index: 10; }
#archwright-xr-entry[hidden], #archwright-xr-entry button[hidden] { display: none; }
#archwright-xr-entry button { min-height: 48px; min-width: 128px; padding: 0 22px; border-radius: 24px; cursor: pointer;
  font: 600 16px/1 system-ui, sans-serif; color: #f4ecdc; background: rgba(38, 32, 27, 0.88); border: 1px solid #c9a46c; }
#archwright-xr-entry button:hover { background: rgba(70, 56, 42, 0.92); }
#archwright-xr-entry button:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
`;

/** Ask what the browser supports, then keep the buttons and __archwright.xrEntry in step with the session. */
export function installXREntry(world: World, arch: ArchRuntime): void {
  hook = arch.hook;
  if (early) hook.xrEntry.error = early;
  const entry = hook.xrEntry;
  const xr = navigator.xr;
  let presenting = !!world.renderer.xr.getSession();
  let bar: HTMLDivElement | null = null;
  const buttons = {} as Record<XRButton, HTMLButtonElement>;

  const build = () => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    bar = document.createElement('div');
    bar.id = 'archwright-xr-entry';
    for (const k of ['ar', 'vr'] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `archwright-enter-${k}`;
      b.textContent = LABEL[k][0];
      b.setAttribute('aria-label', LABEL[k][1]);
      b.addEventListener('click', () => {
        if (world.renderer.xr.getSession()) return;
        try {
          world.launchXR({ sessionMode: MODES[k] });
        } catch (e) {
          xrError(e);
        }
      });
      buttons[k] = b;
      bar.appendChild(b);
    }
    document.body.appendChild(bar);
  };

  const show = () => {
    entry.shown = xrButtons({ ar: !!entry.ar, vr: !!entry.vr, presenting });
    if (!entry.shown.length && !bar) return;
    if (!bar) build();
    bar!.hidden = !entry.shown.length;
    for (const k of ['ar', 'vr'] as const) buttons[k].hidden = !entry.shown.includes(k);
  };

  world.renderer.xr.addEventListener('sessionstart', () => { presenting = true; show(); });
  world.renderer.xr.addEventListener('sessionend', () => { presenting = false; show(); });

  if (!xr) {
    entry.ar = entry.vr = false;
    show();
    return;
  }
  const ask = (mode: XRSessionMode) => xr.isSessionSupported(mode).catch(e => { xrError(e); return false; });
  void Promise.all([ask('immersive-ar'), ask('immersive-vr')]).then(([ar, vr]) => {
    entry.ar = ar;
    entry.vr = vr;
    show();
  });
}

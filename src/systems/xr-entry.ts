// The page's own way into XR (src/game/xr-entry.ts): IWSDK offers the session to the browser, and if that offer does
// not show or the player closes it, "Enter AR" and "Enter VR" buttons at the bottom of the page request it instead.
// They are drawn only for what navigator.xr says it supports (none on a desktop without a headset, so the desktop view
// is as before), hide while a session runs and come back when it ends. A request the browser turns down (one that
// clashes with the pending offer, say) does not reach the console: its message goes to __archwright.xrEntry.error.
// When a session that drew at least one XR frame ends, a "Send device report" link joins the buttons: a new GitHub issue
// filled in with that session's last numbers (src/game/debug.ts reportBody: build, browser, mode, surface, frame rates ...).
// Nothing is sent by the page: the link opens the issue form and the player decides. One link, renewed by each session.
import { createSystem, SessionMode, type World } from '@iwsdk/core';
import type { ArchRuntime, Hook } from '../game/runtime.js';
import { reportAfter, reportShown, xrButtons, type XRButton } from '../game/xr-entry.js';
import { reportBody, reportUrl, shortUA, type ReportInfo } from '../game/debug.js';
import type { FrameSummary } from '../game/frame-stats.js';

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
#archwright-device-report { display: inline-flex; align-items: center; min-height: 48px; padding: 0 22px; border-radius: 24px;
  font: 600 16px/1 system-ui, sans-serif; color: #f4ecdc; background: rgba(38, 32, 27, 0.6); border: 1px dashed #c9a46c;
  text-decoration: none; box-sizing: border-box; }
#archwright-device-report[hidden] { display: none; }
#archwright-device-report:hover { background: rgba(70, 56, 42, 0.92); }
#archwright-device-report:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
`;

/** The session now running, as the device report will tell it: its XR frames so far and its last numbers. */
const session = {
  frames: 0,
  inputs: [] as readonly string[],
  info: {
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, collapsing: false, level: '', state: '',
    xrMode: null, features: [], planes: [], anchors: null, visibility: 'visible', build: '', ua: '', p50: 0, p5: 0, n: 0,
    mode: null, blend: null, surface: null, input: null, meshes: [],
  } as ReportInfo,
};

/** Each XR frame, the numbers a report would carry if the session ended now (no allocation: values and references only). */
class DeviceReportSystem extends createSystem({}) {
  update(): void {
    const arch = this.globals.arch as ArchRuntime | undefined;
    const s = this.renderer.xr.isPresenting ? this.renderer.xr.getSession() : null;
    if (!arch || !s) return;
    const h = arch.hook, i = session.info, p = h.perf;
    const t = this.globals.frameStats as FrameSummary | undefined;
    session.frames++;
    i.fps = p.fps; i.frameMs = p.frameMs; i.drawCalls = p.drawCalls; i.triangles = p.triangles; i.bodies = p.bodies;
    i.level = h.level; i.state = h.state; i.build = h.build;
    i.mode = i.xrMode = h.xr?.mode ?? null;
    i.features = h.xr?.features ?? [];
    session.inputs = h.xr?.inputs ?? [];
    i.blend = s.environmentBlendMode ?? null;
    i.surface = h.surface ?? null;
    i.planes = h.detected?.planes ?? [];
    i.meshes = h.detected?.meshes ?? [];
    i.visibility = s.visibilityState;
    i.p50 = t?.p50 ?? 0; i.p5 = t?.p5 ?? 0; i.n = t?.n ?? 0;
  }
}

/** Ask what the browser supports, then keep the buttons and __archwright.xrEntry in step with the session. */
export function installXREntry(world: World, arch: ArchRuntime): void {
  hook = arch.hook;
  if (early) hook.xrEntry.error = early;
  const entry = hook.xrEntry;
  const xr = navigator.xr;
  let presenting = !!world.renderer.xr.getSession();
  let bar: HTMLDivElement | null = null;
  const buttons = {} as Record<XRButton, HTMLButtonElement>;
  let report: string | null = null;
  let link: HTMLAnchorElement | null = null;
  let linked: string | null = null; // the report link.href was made from
  session.info.ua = shortUA(navigator.userAgent);
  world.registerSystem(DeviceReportSystem);

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

  // The link is made with the first report: before any session there is none on the page.
  const makeLink = () => {
    link = document.createElement('a');
    link.id = 'archwright-device-report';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Send device report';
    link.setAttribute('aria-label', 'Send device report: opens a GitHub issue filled in with the last session\'s numbers; nothing is sent until you submit it');
    bar!.appendChild(link);
  };

  const show = () => {
    entry.shown = xrButtons({ ar: !!entry.ar, vr: !!entry.vr, presenting });
    const offer = reportShown({ presenting, report });
    if (!entry.shown.length && !offer && !bar) return;
    if (!bar) build();
    bar!.hidden = !entry.shown.length && !offer;
    for (const k of ['ar', 'vr'] as const) buttons[k].hidden = !entry.shown.includes(k);
    if (offer && !link) makeLink();
    if (link) link.hidden = !offer;
    if (offer && linked !== report) {
      link!.href = reportUrl(report!);
      linked = report;
    }
  };

  world.renderer.xr.addEventListener('sessionstart', () => {
    presenting = true;
    session.frames = 0;
    show();
  });
  world.renderer.xr.addEventListener('sessionend', () => {
    presenting = false;
    if (session.frames > 0) session.info.input = [...new Set(session.inputs)].join(', ') || null;
    report = reportAfter(report, { frames: session.frames, body: session.frames > 0 ? reportBody(session.info) : '' });
    show();
  });

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

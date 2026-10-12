// ?debug=1: the performance numbers on screen (src/game/debug.ts), for the video and a headset test.
// On the desktop a small text box in the page's corner; in an XR session a page can not be seen, so
// the same lines go on a small slate standing on the desk behind the board's right corner, in the
// site frame like everything else (never fixed to the head). The slate is one more draw call, and
// only in XR with ?debug. Redrawn four times a second; nothing is allocated per frame otherwise.
import {
  CanvasTexture, createSystem, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, XRPlane,
} from '@iwsdk/core';
import type { ArchRuntime } from '../game/runtime.js';
import { debugEnabled, debugLines, type DebugInfo } from '../game/debug.js';
import { BOARD } from '../scene/layout.js';

const REDRAW = 0.25; // s
const SLATE = { width: 0.17, height: 0.085, x: BOARD.width / 2 + 0.1, y: 0.13, z: BOARD.zMin + 0.02, turn: -0.4 };
const CANVAS = { w: 512, h: 256, line: 44, pad: 18 };

export class DebugOverlaySystem extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private on = false;
  private since = REDRAW;
  private box: HTMLDivElement | null = null;
  private slate: Mesh | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tex: CanvasTexture | null = null;
  private labels: string[] = [];
  private info: DebugInfo = {
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, bodies: 0, collapsing: false, level: '', state: '',
    xrMode: null, features: [], planes: [], anchors: null, visibility: 'visible',
  };

  init(): void {
    this.on = debugEnabled(location.search);
  }

  update(delta: number): void {
    if (!this.on) return;
    const arch = this.globals.arch as ArchRuntime | undefined;
    if (!arch?.state) return;
    this.since += delta;
    if (this.since < REDRAW) return;
    this.since = 0;
    const session = this.renderer.xr.isPresenting ? this.renderer.xr.getSession() : null;
    this.gather(arch, session);
    const lines = debugLines(this.info);
    if (session) {
      if (this.box) this.box.style.display = 'none';
      this.drawSlate(arch, lines);
    } else {
      if (this.slate) this.slate.visible = false;
      this.drawBox(lines);
    }
  }

  private gather(arch: ArchRuntime, session: XRSession | null): void {
    const i = this.info, h = arch.hook;
    i.fps = h.perf.fps;
    i.frameMs = h.perf.frameMs;
    i.drawCalls = h.perf.drawCalls;
    i.triangles = h.perf.triangles;
    i.bodies = h.perf.bodies;
    i.collapsing = arch.state.phase === 'collapsed';
    i.level = h.level;
    i.state = h.state;
    i.xrMode = h.xr?.mode ?? null;
    i.features = h.xr?.features ?? [];
    this.labels.length = 0;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as (XRPlane & { semanticLabel?: string }) | undefined;
      if (plane) this.labels.push(plane.semanticLabel ?? '');
    }
    i.planes = this.labels;
    i.anchors = h.museum ? { plinths: h.museum.plinths.length, anchored: h.museum.anchored } : null;
    i.visibility = session ? session.visibilityState : document.visibilityState;
  }

  private drawBox(lines: { text: string; over: boolean }[]): void {
    if (!this.box) {
      const b = document.createElement('div');
      b.id = 'archwright-debug';
      b.setAttribute('aria-hidden', 'true');
      Object.assign(b.style, {
        position: 'fixed', left: '8px', top: '8px', zIndex: '10', pointerEvents: 'none',
        font: '12px/1.45 ui-monospace, Menlo, Consolas, monospace', color: '#f3eee6',
        background: 'rgba(20, 18, 16, 0.72)', padding: '6px 9px', borderRadius: '4px', whiteSpace: 'pre',
      });
      document.body.appendChild(b);
      this.box = b;
    }
    this.box.style.display = 'block';
    this.box.replaceChildren(...lines.map(l => {
      const row = document.createElement('div');
      row.textContent = l.text;
      if (l.over) row.style.color = '#ff7a6b';
      return row;
    }));
  }

  private drawSlate(arch: ArchRuntime, lines: { text: string; over: boolean }[]): void {
    if (!this.slate) {
      const c = document.createElement('canvas');
      c.width = CANVAS.w;
      c.height = CANVAS.h;
      this.ctx = c.getContext('2d');
      this.tex = new CanvasTexture(c);
      this.tex.colorSpace = SRGBColorSpace;
      const m = new Mesh(new PlaneGeometry(SLATE.width, SLATE.height), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
      m.name = 'debug-slate';
      m.position.set(SLATE.x, SLATE.y, SLATE.z);
      m.rotation.y = SLATE.turn;
      m.renderOrder = 5;
      m.userData.keep = true; // survives ArchRuntime.load
      arch.site.add(m);
      this.slate = m;
    }
    this.slate.visible = true;
    const g = this.ctx;
    if (!g || !this.tex) return;
    g.clearRect(0, 0, CANVAS.w, CANVAS.h);
    g.fillStyle = 'rgba(20, 18, 16, 0.78)';
    g.fillRect(0, 0, CANVAS.w, CANVAS.h);
    g.font = `${Math.round(CANVAS.line * 0.62)}px ui-monospace, Menlo, Consolas, monospace`;
    g.textBaseline = 'top';
    lines.forEach((l, k) => {
      g.fillStyle = l.over ? '#ff7a6b' : '#f3eee6';
      g.fillText(l.text, CANVAS.pad, CANVAS.pad + k * CANVAS.line, CANVAS.w - 2 * CANVAS.pad);
    });
    this.tex.needsUpdate = true;
  }
}

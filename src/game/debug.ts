// The ?debug overlay's text (juri/qa.md §7.7): frame rate, JS time per frame, draw calls, triangles,
// physics bodies, the XR session's features, detected planes, museum anchors and page visibility.
// Pure: the numbers come in, lines go out, so the format is tested without a renderer. A number over
// the performance budget (juri/qa.md §7.1) is marked, so a run on the headset shows it at a glance.

/** Per-frame budget: draw calls (more while an arch collapses), visible triangles, dynamic bodies. */
export const BUDGET = { drawCalls: 60, drawCallsCollapse: 100, triangles: 100_000, bodies: 40 } as const;

export interface DebugInfo {
  fps: number;
  frameMs: number;      // JS time per frame (systems), not the GPU's
  drawCalls: number;
  triangles: number;
  bodies: number;
  collapsing: boolean;  // the arch is falling: the larger draw call budget applies
  level: string;
  state: string;
  xrMode: string | null;
  features: string[];
  planes: string[];     // semantic label per detected plane ('' when unlabelled)
  anchors: { plinths: number; anchored: number } | null;
  visibility: string;   // document.visibilityState, or the XR session's
}

export interface DebugLine { text: string; over: boolean }

/** ?debug or ?debug=1 (any value but 0/false/off). */
export function debugEnabled(search: string): boolean {
  const p = new URLSearchParams(search);
  if (!p.has('debug')) return false;
  return !['0', 'false', 'off', 'no'].includes((p.get('debug') ?? '').toLowerCase());
}

const kilo = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Which numbers are over the budget now. */
export function overBudget(i: Pick<DebugInfo, 'drawCalls' | 'triangles' | 'bodies' | 'collapsing'>): { drawCalls: boolean; triangles: boolean; bodies: boolean } {
  return {
    drawCalls: i.drawCalls > (i.collapsing ? BUDGET.drawCallsCollapse : BUDGET.drawCalls),
    triangles: i.triangles > BUDGET.triangles,
    bodies: i.bodies > BUDGET.bodies,
  };
}

/** The overlay, one short line each; a line holding an over-budget number has `over` set. */
export function debugLines(i: DebugInfo): DebugLine[] {
  const o = overBudget(i);
  const dcMax = i.collapsing ? BUDGET.drawCallsCollapse : BUDGET.drawCalls;
  const planes = i.planes.length
    ? `${i.planes.length} (${[...new Set(i.planes.map(l => l || '?'))].slice(0, 4).join(', ')})`
    : '0';
  return [
    { text: `${i.fps.toFixed(1)} fps · js ${i.frameMs.toFixed(2)} ms`, over: false },
    { text: `draws ${i.drawCalls}/${dcMax} · tris ${kilo(i.triangles)}/${kilo(BUDGET.triangles)}`, over: o.drawCalls || o.triangles },
    { text: `bodies ${i.bodies}/${BUDGET.bodies} · ${i.level} ${i.state}`, over: o.bodies },
    { text: `xr ${i.xrMode ?? 'none'}${i.features.length ? ` · ${i.features.join(', ')}` : ''}`, over: false },
    { text: `planes ${planes} · anchors ${i.anchors ? `${i.anchors.anchored}/${i.anchors.plinths}` : '-'} · ${i.visibility}`, over: false },
  ];
}

// Seated reach: from the eyes of a seated player, how far and how far off the line of sight is everything a hand goes
// to (layout.ts reachPoints), on a desk, on the lap tray and in the atelier, for every level. All within 0.8 m.
// The largest values are the README's "Seated reach" table: REACH_TABLE=1 npx vitest run tests/reach.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { reachPoints, type ReachKind } from '../src/scene/layout.js';
import { ATELIER_BELOW_EYES, ATELIER_FORWARD, lapPosition, placeOnDesk, type Vec3 } from '../src/scene/surface-chain.js';

/** Seated: the eye height of the room runs (oda.kabul.mjs) over a 0.75 m desk top. */
const EYE = 1.15, DESK_TOP = 0.75, REACH = 0.8;
const head: Vec3 = { x: 0, y: EYE, z: 0 };
const fwd = { x: 0, z: -1 };
/** Facing -z, the board's yaw is 0 unless the desk turns it (three.js rotationY). */
type Site = { x: number; y: number; z: number; yaw: number };

const desk = (x: number, z: number, width: number, depth: number) =>
  ({ x, y: DESK_TOP, z, width, depth, horizontal: true, source: 'plane' as const });
const onDesk = (d: ReturnType<typeof desk>): Site => {
  const p = placeOnDesk(head, fwd, d);
  return { x: p.x, y: d.y, z: p.z, yaw: p.yaw };
};
const lap = lapPosition(head, fwd);
const PLACEMENTS: Record<string, Site> = {
  'desk ahead': onDesk(desk(0, -0.55, 1.2, 0.6)),
  // A desk off to the left, its centre 0.6 m away: the board goes on its nearest inner corner, turned to the player.
  'desk to the side': onDesk(desk(-0.6, -0.1, 1.2, 0.6)),
  lap: { ...lap, yaw: 0 },
  atelier: { x: 0, y: EYE - ATELIER_BELOW_EYES, z: -ATELIER_FORWARD, yaw: 0 },
};

interface Worst { distance: number; side: number; down: number; up: number; far: ReachKind | null; core: number }
/** What every level needs a hand on: the tray, the open ends and the centering's handle. */
const CORE: ReachKind[] = ['tray stone', 'open end', 'centering handle'];
const deg = (r: number) => (r * 180) / Math.PI;

/** Distance from the eyes, and the angle off straight ahead across (side) and up/down, of each point. */
function measure(site: Site): Worst {
  const ids = LEVELS.map(l => l.id);
  const w: Worst = { distance: 0, side: 0, down: 0, up: 0, far: null, core: 0 };
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  for (const def of LEVELS) {
    for (const p of reachPoints(def, ids)) {
      const x = site.x + p.x * c + p.z * s, z = site.z - p.x * s + p.z * c, y = site.y + p.y;
      const dx = x - head.x, dy = y - head.y, dz = z - head.z;
      const d = Math.hypot(dx, dy, dz), ahead = dx * fwd.x + dz * fwd.z, across = dx * -fwd.z + dz * fwd.x;
      if (d > w.distance) { w.distance = d; w.far = p.kind; }
      if (CORE.includes(p.kind)) w.core = Math.max(w.core, d);
      w.side = Math.max(w.side, Math.abs(deg(Math.atan2(across, ahead))));
      const v = deg(Math.atan2(dy, Math.hypot(dx, dz)));
      w.down = Math.max(w.down, -v);
      w.up = Math.max(w.up, v);
    }
  }
  return w;
}

describe('seated reach', () => {
  const rows = Object.entries(PLACEMENTS).map(([name, site]) => ({ name, ...measure(site) }));

  it.each(rows.map(r => [r.name, r]))('%s: everything a hand goes to is within 0.8 m of the eyes', (_, r) => {
    expect(r.distance).toBeLessThanOrEqual(REACH);
    // In front, within a comfortable turn of the head, and below the eyes.
    expect(r.side).toBeLessThan(90);
    expect(r.up).toBeLessThanOrEqual(0);
  });

  it('every kind of target is measured on every level', () => {
    const ids = LEVELS.map(l => l.id);
    for (const def of LEVELS) {
      const kinds = new Set(reachPoints(def, ids).map(p => p.kind));
      expect([...kinds].sort()).toEqual(['centering handle', 'level marker', 'open end', 'panel icon', 'rebuild stone', 'share tablet', 'tray stone']);
      expect(reachPoints(def, ids).filter(p => p.kind === 'open end')).toHaveLength(def.solution.length);
    }
  });

  if (process.env.REACH_TABLE) {
    it('table', () => {
      for (const r of rows) {
        console.log(`| ${r.name} | ${r.core.toFixed(2)} m | ${r.distance.toFixed(2)} m (${r.far}) | ${r.side.toFixed(0)}° | ${r.down.toFixed(0)}° |`);
      }
    });
  }
});

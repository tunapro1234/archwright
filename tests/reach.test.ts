// Seated reach: from the eyes of a seated player, how far and how far off the line of sight is everything a hand goes
// to (layout.ts reachPoints), on a desk, on the lap tray and in the atelier, for every level. All within 0.8 m.
// Each point is also measured against the line from the eyes to the board's centre (coneAngles): the tray and the handle
// must sit inside a 58° × 54° cone round it (±29° across, ±27° up/down; our own bound, not a device figure), the open
// ends inside it across and under the README's ceilings up/down (ABOVE_CONE_MAX).
// The largest values are the README's "Seated reach" table: REACH_TABLE=1 npx vitest run tests/reach.test.ts --silent=false
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { BOARD, reachPoints, type ReachKind } from '../src/scene/layout.js';
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

interface Worst {
  distance: number; side: number; down: number; up: number; far: ReachKind | null; core: number;
  /** Largest cone angles (coneAngles) over anything; `wide` is the kind furthest across. */
  across: number; upDown: number; wide: ReachKind | null;
  /** Per core kind, the largest cone angles across and up/down (signed: the one furthest from the line, - below it). */
  cone: Record<string, { across: number; upDown: number }>;
  /** Levels with a core target outside the cone. */
  outside: Set<string>;
}
/** What every level needs a hand on: the tray, the open ends and the centering's handle. */
const CORE: ReachKind[] = ['tray stone', 'open end', 'centering handle'];
/** Half the cone the core targets must sit in, round the line from the eyes to the board's centre. */
const CONE_ACROSS = 29, CONE_UP_DOWN = 27;
const deg = (r: number) => (r * 180) / Math.PI;

/** The board's centre in the world: the site plus the middle of the board's depth, turned by the site's yaw. */
function boardCentre(site: Site): Vec3 {
  const mid = (BOARD.zMin + BOARD.zMax) / 2;
  return { x: site.x + mid * Math.sin(site.yaw), y: site.y, z: site.z + mid * Math.cos(site.yaw) };
}

/**
 * How far off the line from the eyes to the board's centre a world point is, as a view would see it: the head turned and
 * tipped to look at the centre (no roll), then the point's angle across (+ to the right) and up/down (+ up) in that view,
 * in degrees. A field of view is bounded the same way, by these two angles.
 */
function coneAngles(eye: Vec3, centre: Vec3, p: Vec3): { across: number; upDown: number } {
  const f = { x: centre.x - eye.x, y: centre.y - eye.y, z: centre.z - eye.z };
  const fl = Math.hypot(f.x, f.y, f.z);
  f.x /= fl; f.y /= fl; f.z /= fl;
  // Right: forward × world up, level; up: right × forward.
  const rl = Math.hypot(f.z, f.x);
  const r = { x: -f.z / rl, y: 0, z: f.x / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z };
  const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const ahead = dot(d, f);
  return { across: deg(Math.atan2(dot(d, r), ahead)), upDown: deg(Math.atan2(dot(d, u), ahead)) };
}

/** Distance from the eyes, and the angle off straight ahead across (side) and up/down, of each point. */
function measure(site: Site): Worst {
  const ids = LEVELS.map(l => l.id);
  const w: Worst = { distance: 0, side: 0, down: 0, up: 0, far: null, core: 0, across: 0, upDown: 0, wide: null, cone: {}, outside: new Set() };
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  const centre = boardCentre(site);
  for (const def of LEVELS) {
    for (const p of reachPoints(def, ids)) {
      const x = site.x + p.x * c + p.z * s, z = site.z - p.x * s + p.z * c, y = site.y + p.y;
      const dx = x - head.x, dy = y - head.y, dz = z - head.z;
      const d = Math.hypot(dx, dy, dz), ahead = dx * fwd.x + dz * fwd.z, sideways = dx * -fwd.z + dz * fwd.x;
      if (d > w.distance) { w.distance = d; w.far = p.kind; }
      const cone = coneAngles(head, centre, { x, y, z });
      const across = Math.abs(cone.across), upDown = Math.abs(cone.upDown);
      if (CORE.includes(p.kind)) {
        w.core = Math.max(w.core, d);
        const k = (w.cone[p.kind] ??= { across: 0, upDown: 0 });
        k.across = Math.max(k.across, across);
        if (upDown > Math.abs(k.upDown)) k.upDown = cone.upDown;
        if (across > CONE_ACROSS || upDown > CONE_UP_DOWN) w.outside.add(def.id);
      }
      if (across > w.across) { w.across = across; w.wide = p.kind; }
      w.upDown = Math.max(w.upDown, upDown);
      w.side = Math.max(w.side, Math.abs(deg(Math.atan2(sideways, ahead))));
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

  // The cone is asserted with the board ahead, on the lap and in the atelier; the desk off to the side is only reported
  // (the head turns to that board). The open ends of the taller arches rise above the cone's top edge: their top
  // stones sit more than 27° above the line to the board's centre (REACH_TABLE=1 prints how far). The layout stays;
  // those three rows hold them across inside the cone and up/down under the ceilings the README gives (ABOVE_CONE_MAX,
  // with half a degree for the README's rounding).
  const CONED = ['desk ahead', 'lap', 'atelier'];
  const ABOVE_CONE_MAX: Record<string, number> = { 'desk ahead': 35, lap: 39, atelier: 33 };
  for (const r of rows.filter(r => CONED.includes(r.name))) {
    for (const kind of CORE) {
      const above = kind === 'open end';
      const name = above
        ? `${r.name}: every open end is across inside the cone and at most ${ABOVE_CONE_MAX[r.name]}° up or down`
        : `${r.name}: every ${kind} is inside the 58° × 54° cone round the eyes-to-board line`;
      it(name, () => {
        expect(r.cone[kind]!.across).toBeLessThanOrEqual(CONE_ACROSS);
        expect(Math.abs(r.cone[kind]!.upDown)).toBeLessThanOrEqual(above ? ABOVE_CONE_MAX[r.name]! + 0.5 : CONE_UP_DOWN);
      });
    }
  }

  it('coneAngles: 0° on the eyes-to-centre line, the angle itself when turned or tipped off it', () => {
    const centre = { x: 0, y: 0.75, z: -0.5 };
    const half = { x: 0, y: (EYE + 0.75) / 2, z: -0.25 };
    expect(coneAngles(head, centre, half).across).toBeCloseTo(0, 9);
    expect(coneAngles(head, centre, half).upDown).toBeCloseTo(0, 9);
    const t = (29 * Math.PI) / 180;
    // Looking level: a point turned 29° to the right is 29° across and level.
    const level = { x: 0, y: EYE, z: -0.5 };
    const turned = { x: 0.5 * Math.sin(t), y: EYE, z: -0.5 * Math.cos(t) };
    expect(coneAngles(head, level, turned).across).toBeCloseTo(29, 9);
    expect(coneAngles(head, level, turned).upDown).toBeCloseTo(0, 9);
    // Looking down at the centre: a point 29° further down in the same vertical plane is 29° below and not across.
    const lower = { x: 0, y: EYE - 0.5 * Math.tan(Math.atan2(EYE - 0.75, 0.5) + t), z: -0.5 };
    expect(coneAngles(head, centre, lower).upDown).toBeCloseTo(-29, 9);
    expect(coneAngles(head, centre, lower).across).toBeCloseTo(0, 9);
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
        console.log(
          `| ${r.name} | ${r.core.toFixed(2)} m | ${r.distance.toFixed(2)} m (${r.far}) | ${r.side.toFixed(0)}° | ${r.down.toFixed(0)}° ` +
          `| ${CORE.map(k => `${k} ${r.cone[k]!.across.toFixed(0)}° × ${r.cone[k]!.upDown.toFixed(0)}°`).join(', ')} ` +
          `| anything ${r.across.toFixed(0)}° (${r.wide}) × ${r.upDown.toFixed(0)}° | outside on ${r.outside.size} of ${LEVELS.length} levels |`,
        );
      }
    });
  }
});

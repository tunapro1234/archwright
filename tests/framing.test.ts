// The desktop camera frames each level (src/game/desktop.ts frameView over layout viewPoints): the
// same check uretim/kabul/kadraj.kabul.mjs makes in the browser, here for every level and a few
// window shapes. Crown, both abutments, the centering's handle and every tray stone of the solution
// fall inside the view with a 4 % margin, and the arch is not lost in the distance.
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels/index.js';
import { createLevel } from '../src/game/arch-state.js';
import { dailyLevel } from '../src/game/daily.js';
import { frameView, projectView, VIEW_ELEVATION } from '../src/game/desktop.js';
import { abutmentTop, ABUTMENT_HEIGHT, ashlarBlocks, abutments, CENTERING, crownPoint, stoneOutline, trayPoses, viewPoints } from '../src/scene/layout.js';

const FOV = 50; // IWSDK's default vertical field of view
const IDS = LEVELS.map(l => l.id);
const SCREENS = [[1280, 720], [1024, 768], [1920, 1080]] as const;

const levels = [...LEVELS, dailyLevel('2026-10-12'), dailyLevel('2026-10-20')];

describe.each(levels.map(l => [l.id, l] as const))('desktop framing %s', (_, def) => {
  const geo = createLevel(def).geometry;
  const targets: Record<string, { x: number; y: number; z: number }> = {
    crown: crownPoint(def),
    'abutment:left': abutmentTop(def, 'left'),
    'abutment:right': abutmentTop(def, 'right'),
    lever: { x: 0, y: 0.022, z: def.depth * 0.46 + CENTERING.handleDepth / 2 },
  };
  const poses = trayPoses(def);
  for (const step of def.solution) {
    const i = def.tray.findIndex(s => s.id === step.stone);
    const o = stoneOutline(geo, def.tray[i]);
    const cx = (Math.min(...o.map(v => v.x)) + Math.max(...o.map(v => v.x))) / 2;
    const cy = (Math.min(...o.map(v => v.y)) + Math.max(...o.map(v => v.y))) / 2;
    targets[step.stone] = { x: poses[i].x + cx, y: def.depth - 0.002, z: poses[i].z - cy };
  }

  it.each(SCREENS.map(s => [`${s[0]}x${s[1]}`, s] as const))('%s: every target inside the 4 %% margin, abutments ≥ 25 %% apart', (_, [W, H]) => {
    const view = frameView(viewPoints(def, IDS), FOV, W / H);
    for (const [name, p] of Object.entries(targets)) {
      const q = projectView(view, FOV, W, H, p);
      expect(q, name).not.toBeNull();
      expect(q!.x, name).toBeGreaterThan(0.04 * W);
      expect(q!.x, name).toBeLessThan(0.96 * W);
      expect(q!.y, name).toBeGreaterThan(0.04 * H);
      expect(q!.y, name).toBeLessThan(0.96 * H);
    }
    const l = projectView(view, FOV, W, H, targets['abutment:left'])!, r = projectView(view, FOV, W, H, targets['abutment:right'])!;
    expect(r.x - l.x).toBeGreaterThanOrEqual(0.25 * W);
  });

  it('looks down at VIEW_ELEVATION, straight along the board', () => {
    const { eye, target } = frameView(viewPoints(def, IDS), FOV, 16 / 9);
    expect(eye.x).toBeCloseTo(target.x, 9);
    expect(Math.atan2(eye.y - target.y, eye.z - target.z)).toBeCloseTo(VIEW_ELEVATION, 9);
    expect(eye.z).toBeGreaterThan(0.3); // in front of the board's near edge
  });

  it('crown is on the arch\'s back over its middle; abutment tops are the springing level', () => {
    const c = crownPoint(def);
    expect(c.x).toBe(0);
    // A pointed crown's keystone cuts its point off, so the back there is below rise + thickness.
    expect(c.y).toBeGreaterThan(ABUTMENT_HEIGHT + 0.8 * def.rise);
    expect(c.y).toBeLessThan(ABUTMENT_HEIGHT + def.rise + 0.06);
    expect(abutmentTop(def, 'left')).toEqual({ x: -abutmentTop(def, 'right').x, y: ABUTMENT_HEIGHT, z: 0 });
  });

  it('ashlar blocks fill each abutment exactly, in two courses with staggered joints', () => {
    const depth = def.depth + 0.012;
    for (const a of abutments(def)) {
      const b = ashlarBlocks(a, depth);
      const volume = b.reduce((v, k) => v + k.w * k.h * k.d, 0);
      expect(volume).toBeCloseTo(a.width * a.height * depth, 12);
      for (const k of b) {
        expect(k.x - k.w / 2).toBeGreaterThanOrEqual(a.x - a.width / 2 - 1e-12);
        expect(k.x + k.w / 2).toBeLessThanOrEqual(a.x + a.width / 2 + 1e-12);
        expect(k.y - k.h / 2).toBeGreaterThanOrEqual(-1e-12);
        expect(k.y + k.h / 2).toBeLessThanOrEqual(a.height + 1e-12);
      }
      const courses = [...new Set(b.map(k => Math.round((k.y - k.h / 2) * 1e6)))];
      expect(courses.length).toBe(2);
      // The lower course's vertical joint (at a.x) is covered by an unbroken cap above it.
      const cap = b.filter(k => k.y > a.height / 2);
      for (const k of cap) expect(k.w).toBeCloseTo(a.width, 12);
    }
  });
});

describe('frameView', () => {
  it('a tall arch pulls the camera back', () => {
    const low = LEVELS.find(l => l.id === 'w1-1')!, tall = LEVELS.find(l => l.id === 'w2-2')!;
    const d = (def: typeof low) => {
      const { eye, target } = frameView(viewPoints(def, IDS), FOV, 16 / 9);
      return Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z);
    };
    expect(d(tall)).toBeGreaterThan(d(low));
  });

  it('is deterministic and leaves its input alone', () => {
    const pts = viewPoints(LEVELS[0], IDS);
    const copy = JSON.parse(JSON.stringify(pts));
    expect(frameView(pts, FOV, 1.5)).toEqual(frameView(pts, FOV, 1.5));
    expect(pts).toEqual(copy);
  });
});

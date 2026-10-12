// World 1 (Roman, semicircular centering), world 2 (pointed centering) and world 3 (loads: a
// tower, a bell or a cart stands on the finished arch). Each level is a few design choices (span, courses, which
// stones are on offer); every block, joint and weight is generated from them by ringArch, and the
// solver checks the solution and the trap (tests and `npm run level-check`).
import type { LevelDef, Load, Material, StoneDef, Step } from '../game/arch-state.js';

interface Kind {
  material: Material;
  t: number;          // radial thickness as a fraction of the centering radius
  units?: number;     // 2 for a wide wedge
  keystone?: boolean;
  count: number;
}
interface Arrangement { left: string[]; right: string[]; key: string } // kind names, springing to crown

export interface LevelSpec {
  id: string;
  span: number;       // m
  rise?: number;      // m, default span/2 (semicircle)
  stones: number;     // courses of the centering
  depth?: number;     // m
  tray: Record<string, Kind>;
  solution: Arrangement;
  trap: Arrangement;
  loads?: Load[];     // world 3: weights standing on the arch
}

export function level(p: LevelSpec): LevelDef {
  const radius = p.span / 2;
  const tray: StoneDef[] = [];
  for (const [name, k] of Object.entries(p.tray)) {
    for (let i = 1; i <= k.count; i++) {
      tray.push({ id: `${name}-${i}`, material: k.material, t: k.t * radius, units: k.units ?? 1, ...(k.keystone ? { keystone: true } : {}) });
    }
  }
  // Kind names to concrete ids, alternating sides the way a player builds, keystone last.
  const steps = (a: Arrangement): Step[] => {
    const next = new Map<string, number>();
    const id = (name: string) => {
      if (!p.tray[name]) throw new Error(`${p.id}: no stone kind ${name}`);
      const n = (next.get(name) ?? 0) + 1;
      next.set(name, n);
      return `${name}-${n}`;
    };
    const out: Step[] = [];
    for (let i = 0; i < Math.max(a.left.length, a.right.length); i++) {
      if (i < a.left.length) out.push({ stone: id(a.left[i]), side: 'left' });
      if (i < a.right.length) out.push({ stone: id(a.right[i]), side: 'right' });
    }
    out.push({ stone: id(a.key), side: 'left' });
    return out;
  };
  const solution = steps(p.solution);
  return {
    id: p.id,
    span: p.span,
    rise: p.rise ?? radius,
    stones: p.stones,
    depth: p.depth ?? 0.06,
    tray,
    solution,
    trap: steps(p.trap),
    par: solution.length,
    ...(p.loads ? { loads: p.loads } : {}),
  };
}

const HEAVY = 0.22;
const THICK = 0.16;
const MEDIUM = 0.11;
const SLIM = 0.09;
const THIN = 0.07;

export const LEVELS: LevelDef[] = [
  level({
    id: 'w1-1',
    span: 0.3,
    stones: 5,
    tray: {
      sandstone: { material: 'sandstone', t: THICK, count: 4 },
      tuff: { material: 'tuff', t: THIN, count: 2 },
      keystone: { material: 'sandstone', t: THICK, keystone: true, count: 1 },
    },
    // A thin stone on the springing cannot take the thrust.
    solution: { left: ['sandstone', 'sandstone'], right: ['sandstone', 'sandstone'], key: 'keystone' },
    trap: { left: ['tuff', 'sandstone'], right: ['sandstone', 'sandstone'], key: 'keystone' },
  }),
  level({
    id: 'w1-2',
    span: 0.3,
    stones: 7,
    tray: {
      sandstone: { material: 'sandstone', t: THICK, count: 2 },
      wide: { material: 'sandstone', t: THICK, units: 2, count: 2 },
      tuff: { material: 'tuff', t: THIN, count: 3 },
      keystone: { material: 'sandstone', t: THICK, keystone: true, count: 1 },
    },
    solution: { left: ['wide', 'sandstone'], right: ['wide', 'sandstone'], key: 'keystone' },
    // Fewer stones with the wide wedges, but the halves have to weigh the same.
    trap: { left: ['wide', 'sandstone'], right: ['sandstone', 'tuff', 'tuff'], key: 'keystone' },
  }),
  level({
    id: 'w1-3',
    span: 0.3,
    stones: 9,
    tray: {
      sandstone: { material: 'sandstone', t: THICK, count: 4 },
      tuff: { material: 'tuff', t: THIN, count: 4 },
      basalt: { material: 'basalt', t: THICK, count: 2 },
      keystone: { material: 'tuff', t: THIN, keystone: true, count: 1 },
    },
    // Heavy at the feet, light at the crown; the same stones the other way round fall.
    solution: { left: ['basalt', 'sandstone', 'tuff', 'tuff'], right: ['basalt', 'sandstone', 'tuff', 'tuff'], key: 'keystone' },
    trap: { left: ['tuff', 'tuff', 'sandstone', 'basalt'], right: ['tuff', 'tuff', 'sandstone', 'basalt'], key: 'keystone' },
  }),
  level({
    id: 'w1-4',
    span: 0.34,
    stones: 9,
    tray: {
      sandstone: { material: 'sandstone', t: THICK, count: 2 },
      tuff: { material: 'tuff', t: SLIM, count: 8 },
      keystone: { material: 'tuff', t: SLIM, keystone: true, count: 1 },
    },
    // A wider arch and only two thick stones: they belong at the feet, where the thrust bends out.
    solution: { left: ['sandstone', 'tuff', 'tuff', 'tuff'], right: ['sandstone', 'tuff', 'tuff', 'tuff'], key: 'keystone' },
    // Strengthening the crown instead feels right and fails.
    trap: { left: ['tuff', 'tuff', 'tuff', 'sandstone'], right: ['tuff', 'tuff', 'tuff', 'sandstone'], key: 'keystone' },
  }),
  level({
    id: 'w1-5',
    span: 0.32,
    stones: 9,
    tray: {
      basalt: { material: 'basalt', t: THICK, count: 2 },
      sandstone: { material: 'sandstone', t: MEDIUM, count: 2 },
      wide: { material: 'tuff', t: THIN, units: 2, count: 2 },
      tuff: { material: 'tuff', t: THIN, count: 2 },
      keystone: { material: 'tuff', t: THIN, keystone: true, count: 1 },
    },
    // A big block is not a strong one: the wide wedges are thin tuff and go up by the keystone.
    solution: { left: ['basalt', 'sandstone', 'wide'], right: ['basalt', 'sandstone', 'wide'], key: 'keystone' },
    // Laid at the feet like a foundation, they let the arch close in as few stones and it just fails.
    trap: { left: ['wide', 'basalt', 'sandstone'], right: ['wide', 'basalt', 'sandstone'], key: 'keystone' },
  }),
  // World 2: pointed centerings (rise > span/2). The two-centred curve leans the thrust inwards, so
  // stones too slim for a semicircle can stand; where the heavy and the wide ones go still decides it.
  level({
    id: 'w2-1',
    span: 0.3,
    rise: 0.21,
    stones: 7,
    tray: {
      sandstone: { material: 'sandstone', t: SLIM, count: 6 },
      tuff: { material: 'tuff', t: THIN, count: 2 },
      keystone: { material: 'sandstone', t: SLIM, keystone: true, count: 1 },
    },
    // Slim stones that fall on a semicircle stand on a pointed centering.
    solution: { left: ['sandstone', 'sandstone', 'sandstone'], right: ['sandstone', 'sandstone', 'sandstone'], key: 'keystone' },
    // Even here the thinnest stones cannot take the springing.
    trap: { left: ['tuff', 'sandstone', 'sandstone'], right: ['tuff', 'sandstone', 'sandstone'], key: 'keystone' },
  }),
  level({
    id: 'w2-2',
    span: 0.3,
    rise: 0.27,
    stones: 9,
    tray: {
      tuff: { material: 'tuff', t: THIN, count: 8 },
      basalt: { material: 'basalt', t: THIN, count: 2 },
      keystone: { material: 'tuff', t: THIN, keystone: true, count: 1 },
    },
    // A tall pointed arch stands on the thinnest, lightest stones.
    solution: { left: ['basalt', 'tuff', 'tuff', 'tuff'], right: ['basalt', 'tuff', 'tuff', 'tuff'], key: 'keystone' },
    // Weight up by the point pushes its two halves apart.
    trap: { left: ['tuff', 'tuff', 'tuff', 'basalt'], right: ['tuff', 'tuff', 'tuff', 'basalt'], key: 'keystone' },
  }),
  level({
    id: 'w2-3',
    span: 0.34,
    rise: 0.19,
    stones: 9,
    tray: {
      sandstone: { material: 'sandstone', t: MEDIUM, count: 4 },
      tuff: { material: 'tuff', t: SLIM, count: 6 },
      keystone: { material: 'tuff', t: SLIM, keystone: true, count: 1 },
    },
    // Barely pointed: it behaves almost like a semicircle, so the thicker stones go to the feet.
    solution: { left: ['sandstone', 'sandstone', 'tuff', 'tuff'], right: ['sandstone', 'sandstone', 'tuff', 'tuff'], key: 'keystone' },
    trap: { left: ['tuff', 'tuff', 'sandstone', 'sandstone'], right: ['tuff', 'tuff', 'sandstone', 'sandstone'], key: 'keystone' },
  }),
  level({
    id: 'w2-4',
    span: 0.32,
    rise: 0.24,
    stones: 9,
    tray: {
      basalt: { material: 'basalt', t: THIN, count: 2 },
      sandstone: { material: 'sandstone', t: SLIM, count: 2 },
      tuff: { material: 'tuff', t: THIN, count: 6 },
      keystone: { material: 'tuff', t: THIN, keystone: true, count: 1 },
    },
    // Four heavy stones and six light ones: the heavy ones low on each side, the light ones up to the point.
    solution: { left: ['sandstone', 'basalt', 'tuff', 'tuff'], right: ['sandstone', 'basalt', 'tuff', 'tuff'], key: 'keystone' },
    trap: { left: ['tuff', 'tuff', 'sandstone', 'basalt'], right: ['tuff', 'tuff', 'sandstone', 'basalt'], key: 'keystone' },
  }),
  level({
    id: 'w2-5',
    span: 0.32,
    rise: 0.22,
    stones: 9,
    tray: {
      wide: { material: 'sandstone', t: SLIM, units: 2, count: 2 },
      sandstone: { material: 'sandstone', t: SLIM, count: 4 },
      tuff: { material: 'tuff', t: THIN, count: 4 },
      keystone: { material: 'sandstone', t: SLIM, keystone: true, count: 1 },
    },
    // Wide wedges save stones on the springing, where a pointed arch is steep and heavy.
    solution: { left: ['wide', 'sandstone', 'tuff'], right: ['wide', 'sandstone', 'tuff'], key: 'keystone' },
    // Up by the point their weight bends the arch open.
    trap: { left: ['tuff', 'sandstone', 'wide'], right: ['tuff', 'sandstone', 'wide'], key: 'keystone' },
  }),
// World 3: loads. Each one stands on the stone that covers its course and goes to the solver as a
  // point load on that stone's back. Every trap here holds with nothing on it; the load brings it down.
  // A stone weighs about 0.2 to 0.4 kg at this scale, so a 0.3 to 0.7 kg load is a lot.
  level({
    id: 'w3-1',
    span: 0.3,
    stones: 5,
    loads: [{ course: 2, kg: 0.6, kind: 'tower' }],
    tray: {
      sandstone: { material: 'sandstone', t: HEAVY, count: 2 },
      tuff: { material: 'tuff', t: THICK, count: 4 },
      keystone: { material: 'tuff', t: THICK, keystone: true, count: 1 },
    },
    // A tower on the keystone: the two heavy stones go to the feet.
    solution: { left: ['sandstone', 'tuff'], right: ['sandstone', 'tuff'], key: 'keystone' },
    // Both heavy stones on one side: the empty ring stands, the tower tips it over.
    trap: { left: ['sandstone', 'sandstone'], right: ['tuff', 'tuff'], key: 'keystone' },
  }),
  level({
    id: 'w3-2',
    span: 0.3,
    stones: 7,
    loads: [{ course: 2, kg: 0.5, kind: 'bell' }],
    tray: {
      sandstone: { material: 'sandstone', t: HEAVY, count: 3 },
      tuff: { material: 'tuff', t: THICK, count: 4 },
      keystone: { material: 'tuff', t: THICK, keystone: true, count: 1 },
    },
    // A bell off the crown, towards the quarter span, where a load strains an arch most. The heavy
    // stones balance it from the other side.
    solution: { left: ['sandstone', 'tuff', 'tuff'], right: ['sandstone', 'tuff', 'sandstone'], key: 'keystone' },
    // Propping the bell up from below feels right, and fails.
    trap: { left: ['sandstone', 'sandstone', 'tuff'], right: ['tuff', 'tuff', 'tuff'], key: 'keystone' },
  }),
  level({
    id: 'w3-3',
    span: 0.32,
    stones: 9,
    loads: [{ course: 3, kg: 0.6, kind: 'cart' }],
    tray: {
      basalt: { material: 'basalt', t: HEAVY, count: 2 },
      sandstone: { material: 'sandstone', t: THICK, count: 2 },
      tuff: { material: 'tuff', t: THICK, count: 5 },
      keystone: { material: 'tuff', t: THICK, keystone: true, count: 1 },
    },
    // A cart on the left haunch pushes the arch over to the right: the basalt goes there, as a counterweight.
    solution: { left: ['tuff', 'sandstone', 'sandstone', 'tuff'], right: ['basalt', 'tuff', 'basalt', 'tuff'], key: 'keystone' },
    // Every heavy stone under the cart: the side that has to push back is left light.
    trap: { left: ['sandstone', 'sandstone', 'basalt', 'tuff'], right: ['tuff', 'tuff', 'tuff', 'tuff'], key: 'keystone' },
  }),
  level({
    id: 'w3-4',
    span: 0.32,
    stones: 9,
    loads: [{ course: 4, kg: 0.7, kind: 'tower' }, { course: 2, kg: 0.3, kind: 'bell' }],
    tray: {
      sandstone: { material: 'sandstone', t: HEAVY, count: 4 },
      tuff: { material: 'tuff', t: THICK, count: 5 },
      keystone: { material: 'tuff', t: THICK, keystone: true, count: 1 },
    },
    // A tower on the crown and a bell on the left: the heavy stones lean against them from the right.
    solution: { left: ['tuff', 'tuff', 'sandstone', 'tuff'], right: ['sandstone', 'sandstone', 'sandstone', 'tuff'], key: 'keystone' },
    trap: { left: ['tuff', 'sandstone', 'sandstone', 'sandstone'], right: ['tuff', 'tuff', 'tuff', 'sandstone'], key: 'keystone' },
  }),
  level({
    id: 'w3-5',
    span: 0.3,
    rise: 0.24,
    stones: 7,
    loads: [{ course: 3, kg: 0.6, kind: 'tower' }],
    tray: {
      sandstone: { material: 'sandstone', t: THICK, count: 4 },
      tuff: { material: 'tuff', t: MEDIUM, count: 4 },
      keystone: { material: 'sandstone', t: THICK, keystone: true, count: 1 },
    },
    // A pointed arch under a tower: heavy stones at the feet and against the point, light ones between.
    solution: { left: ['sandstone', 'tuff', 'sandstone'], right: ['sandstone', 'tuff', 'sandstone'], key: 'keystone' },
    // Even a pointed arch tips over under the tower when the weight is all on one side.
    trap: { left: ['sandstone', 'sandstone', 'tuff'], right: ['tuff', 'tuff', 'tuff'], key: 'keystone' },
  }),
];

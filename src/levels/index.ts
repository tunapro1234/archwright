// World 1 (Roman, semicircular centering). Each level is a few design choices (span, courses, which
// stones are on offer); every block, joint and weight is generated from them by ringArch, and the
// solver checks the solution and the trap (tests and `npm run level-check`).
import type { LevelDef, Material, StoneDef, Step } from '../game/arch-state.js';

interface Kind {
  material: Material;
  t: number;          // radial thickness as a fraction of the centering radius
  units?: number;     // 2 for a wide wedge
  keystone?: boolean;
  count: number;
}
interface Arrangement { left: string[]; right: string[]; key: string } // kind names, springing to crown

interface LevelSpec {
  id: string;
  span: number;       // m
  rise?: number;      // m, default span/2 (semicircle)
  stones: number;     // courses of the centering
  depth?: number;     // m
  tray: Record<string, Kind>;
  solution: Arrangement;
  trap: Arrangement;
}

function level(p: LevelSpec): LevelDef {
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
  };
}

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
];

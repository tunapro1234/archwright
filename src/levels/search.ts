// Exhaustive check of a level: every distinct way to close its arch with the tray it offers.
// Stones of the same kind are interchangeable, so arrangements are counted by kind. Used by the
// level-check script and the tests, not by the game at runtime (it calls the solver thousands of times).
import { createLevel, placeStone, strike, type LevelDef, type StoneDef, type Step } from '../game/arch-state.js';
import type { SolveResult } from '../statics/index.js';

export const kindOf = (s: StoneDef): string => `${s.material}|${s.t}|${s.units}|${s.keystone ? 'key' : 'v'}`;

export interface Arrangement { steps: Step[]; stones: number; result: SolveResult }

/** All closed arrangements of `def`, each solved once. */
export function arrangements(def: LevelDef): Arrangement[] {
  const kinds = new Map<string, StoneDef[]>();
  for (const s of def.tray) {
    const k = kindOf(s);
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k)!.push(s);
  }
  const voussoirs = [...kinds.values()].filter(g => !g[0].keystone);
  const keystones = [...kinds.values()].filter(g => g[0].keystone);
  const half = def.stones / 2;

  // Every sequence of voussoir kinds, springing outwards, that a half can take (<= half the courses).
  function halves(used: Map<StoneDef[], number>): StoneDef[][][] {
    const out: StoneDef[][][] = [];
    const walk = (seq: StoneDef[][], units: number) => {
      out.push(seq.slice());
      for (const g of voussoirs) {
        const u = g[0].units, n = used.get(g) ?? 0;
        if (units + u > half || n >= g.length) continue;
        used.set(g, n + 1);
        seq.push(g);
        walk(seq, units + u);
        seq.pop();
        used.set(g, n);
      }
    };
    walk([], 0);
    return out;
  }

  const res: Arrangement[] = [];
  const used = new Map<StoneDef[], number>();
  for (const L of halves(used)) {
    for (const g of L) used.set(g, (used.get(g) ?? 0) + 1);
    const lu = L.reduce((s, g) => s + g[0].units, 0);
    for (const R of halves(used)) {
      const ru = R.reduce((s, g) => s + g[0].units, 0);
      for (const K of keystones) {
        if (K[0].units !== def.stones - lu - ru) continue;
        const steps = assign(L, R, K);
        let s = createLevel(def);
        for (const st of steps) s = placeStone(s, st.stone, st.side);
        if (s.error || s.phase !== 'ready') throw new Error(`${def.id}: enumerated arrangement refused: ${s.error}`);
        res.push({ steps, stones: steps.length, result: strike(s).result });
      }
    }
    for (const g of L) used.set(g, used.get(g)! - 1);
  }
  return res;
}

// Concrete stone ids for an arrangement by kind: left half, then right half, then the keystone.
function assign(L: StoneDef[][], R: StoneDef[][], K: StoneDef[]): Step[] {
  const taken = new Map<StoneDef[], number>();
  const pick = (g: StoneDef[]) => { const n = taken.get(g) ?? 0; taken.set(g, n + 1); return g[n].id; };
  return [
    ...L.map(g => ({ stone: pick(g), side: 'left' as const })),
    ...R.map(g => ({ stone: pick(g), side: 'right' as const })),
    { stone: pick(K), side: 'left' as const },
  ];
}

export interface LevelReport {
  id: string;
  closed: number;          // distinct closed arrangements
  holding: number;         // of which hold when struck
  par: number;             // fewest stones in a holding arrangement (NaN if none)
  bestMargin: number;
  solution: SolveResult;
  trap: SolveResult;
}

function play(def: LevelDef, steps: Step[]): SolveResult {
  let s = createLevel(def);
  for (const st of steps) s = placeStone(s, st.stone, st.side);
  if (s.error) throw new Error(`${def.id}: ${s.error}`);
  return strike(s).result;
}

export function checkLevel(def: LevelDef): LevelReport {
  const all = arrangements(def);
  const ok = all.filter(a => a.result.stands);
  return {
    id: def.id,
    closed: all.length,
    holding: ok.length,
    par: ok.length ? Math.min(...ok.map(a => a.stones)) : NaN,
    bestMargin: ok.length ? Math.max(...ok.map(a => a.result.minMargin)) : NaN,
    solution: play(def, def.solution),
    trap: play(def, def.trap),
  };
}

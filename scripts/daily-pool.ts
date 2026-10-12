// Builds the pool of daily levels (Today's Span) and writes src/levels/daily-pool.ts.
// Run: npx tsx scripts/daily-pool.ts
//
// Seeded generate-and-check, done once here and not on the headset: a random level (span, centering,
// courses, tray, maybe a load) is drawn from a fixed seed, every way to close it is solved, and it is
// kept only if it passes the same rules as the world levels: its best fewest-stone arrangement holds
// with a margin of at least MIN_MARGIN, some arrangement that closes the arch falls (the trap), and
// between 2 % and MAX_RATIO of the closed arrangements hold. Kept levels are sorted into three kinds
// (semicircle, pointed, loaded) and dealt out in turn, so any run of days mixes all three.
import { writeFileSync } from 'node:fs';
import { level, type LevelSpec } from '../src/levels/index.ts';
import { arrangements, checkLevel } from '../src/levels/search.ts';
import { createLevel, placeStone, strike, type Load, type LoadKind, type Material, type Step } from '../src/game/arch-state.ts';

const SEED = 20261001;
const PER_KIND = 16;          // pool = 3 * PER_KIND levels, one a day, then it starts over
const MIN_MARGIN = 0.06;      // a little above the 0.05 the tests ask for
const MIN_CLOSED = 14;        // enough ways to close the arch that the choice is a real one
const MAX_CLOSED = 260;       // keeps a level's full check (tests, level-check) well under a second
const MAX_RATIO = 0.45;       // world levels may go to 60 %; a daily should not be a coin toss

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const T = { heavy: 0.22, thick: 0.16, medium: 0.11, slim: 0.09, thin: 0.07 } as const;
const MATERIALS: Material[] = ['sandstone', 'tuff', 'basalt'];
const KINDS: LoadKind[] = ['tower', 'bell', 'cart'];
type Category = 'semicircle' | 'pointed' | 'loaded';
type Pooled = Omit<LevelSpec, 'id'>;

function draw(cat: Category): Pooled {
  const span = pick([0.28, 0.3, 0.32, 0.34]);
  const pointed = cat === 'pointed' || (cat === 'loaded' && rand() < 0.4);
  const rise = pointed ? +(span / 2 + pick([0.03, 0.05, 0.07, 0.09])).toFixed(3) : undefined;
  const stones = pick([5, 7, 7, 9]);
  const nKinds = stones === 9 ? 2 : pick([2, 3, 3]);
  const tray: LevelSpec['tray'] = {};
  const thick = cat === 'loaded' ? [T.heavy, T.thick, T.thick, T.medium] : pointed ? [T.medium, T.slim, T.thin, T.thin] : [T.thick, T.medium, T.slim, T.thin];
  const seen = new Set<string>();
  let units = 0;
  while (Object.keys(tray).length < nKinds) {
    const material = pick(MATERIALS);
    const t = pick(thick);
    const wide = stones >= 7 && rand() < 0.2;
    const key = `${material}|${t}|${wide}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const base = wide ? `wide-${material}` : material;
    const name = tray[base] ? `${base}-${t >= T.thick ? 'thick' : 'thin'}` : base;
    if (tray[name]) continue;
    const count = int(1, (stones - 1) / 2 + 1);
    tray[name] = { material, t, count, ...(wide ? { units: 2 } : {}) };
    units += count * (wide ? 2 : 1);
  }
  // Enough voussoirs to close the arch with a few to spare.
  const names = Object.keys(tray);
  while (units < stones + 1) {
    const k = tray[pick(names)];
    k.count++;
    units += k.units ?? 1;
  }
  const kt = Object.values(tray).map(k => k.t);
  tray.keystone = { material: pick(MATERIALS), t: pick(kt), keystone: true, count: 1 };
  const loads: Load[] = [];
  if (cat === 'loaded') {
    loads.push({ course: int(0, stones - 1), kg: pick([0.3, 0.4, 0.5, 0.6, 0.7]), kind: pick(KINDS) });
    if (rand() < 0.25) {
      const c = int(0, stones - 1);
      if (c !== loads[0].course) loads.push({ course: c, kg: pick([0.2, 0.3, 0.4]), kind: pick(KINDS) });
    }
  }
  const none = { left: [], right: [], key: 'keystone' };
  return { span, ...(rise ? { rise } : {}), stones, tray, solution: none, trap: none, ...(loads.length ? { loads } : {}) };
}

// Closed arrangements of a tray, counted without solving: the same walk as search.arrangements.
function countClosed(p: Pooled): number {
  const kinds = Object.values(p.tray).filter(k => !k.keystone);
  const key = Object.values(p.tray).find(k => k.keystone)!;
  const half = p.stones / 2;
  const used = kinds.map(() => 0);
  const halves: { units: number; use: number[] }[] = [];
  const walk = (u: number) => {
    halves.push({ units: u, use: used.slice() });
    kinds.forEach((k, i) => {
      const w = k.units ?? 1;
      if (u + w > half || used[i] >= k.count) return;
      used[i]++; walk(u + w); used[i]--;
    });
  };
  walk(0);
  let n = 0;
  for (const L of halves) for (const R of halves) {
    if (L.units + R.units + (key.units ?? 1) !== p.stones) continue;
    if (kinds.every((k, i) => L.use[i] + R.use[i] <= k.count)) n++;
  }
  return n;
}

const nameOf = (id: string) => id.replace(/-\d+$/, '');
const toKinds = (steps: Step[]) => ({
  left: steps.filter((s, i) => s.side === 'left' && i < steps.length - 1).map(s => nameOf(s.stone)),
  right: steps.filter(s => s.side === 'right').map(s => nameOf(s.stone)),
  key: nameOf(steps[steps.length - 1].stone),
});
const multiset = (steps: Step[]) => steps.map(s => nameOf(s.stone)).sort().join(',');

function holdsUnloaded(p: Pooled, steps: Step[]): boolean {
  let s = createLevel(level({ ...p, id: 'x', loads: undefined }));
  for (const st of steps) s = placeStone(s, st.stone, st.side);
  return strike(s).result.stands;
}

function finish(p: Pooled): Pooled | null {
  const n = countClosed(p);
  if (n < MIN_CLOSED || n > MAX_CLOSED) return null;
  const all = arrangements(level({ ...p, id: 'x' }));
  const ok = all.filter(a => a.result.stands);
  const ratio = ok.length / all.length;
  if (ratio < 0.02 || ratio > MAX_RATIO) return null;
  const par = Math.min(...ok.map(a => a.stones));
  const best = ok.filter(a => a.stones === par).sort((a, b) => b.result.minMargin - a.result.minMargin)[0];
  if (best.result.minMargin < MIN_MARGIN) return null;
  // The trap: an arrangement that closes the arch and falls, as tempting as can be: the same stones
  // as the solution, or (with a load) one that would have held without it, and in few stones.
  const same = multiset(best.steps);
  const score = (a: (typeof all)[number]) =>
    (multiset(a.steps) === same ? 4 : 0) + (p.loads && holdsUnloaded(p, a.steps) ? 3 : 0) + (a.stones <= par ? 1 : 0) + a.result.minMargin;
  const falls = all.filter(a => !a.result.stands);
  if (!falls.length) return null;
  let trap = falls[0], top = -Infinity;
  for (const a of falls) { const s = score(a); if (s > top) { top = s; trap = a; } }
  return { ...p, solution: toKinds(best.steps), trap: toKinds(trap.steps) };
}

const imza = (l: ReturnType<typeof level>) =>
  JSON.stringify([l.span, l.rise, l.stones, l.tray.map(t => [t.material, t.t, t.units, !!t.keystone]).sort(), l.loads ?? []]);

const t0 = performance.now();
const found: Record<Category, Pooled[]> = { semicircle: [], pointed: [], loaded: [] };
const sigs = new Set<string>();
let tries = 0;
for (const cat of ['semicircle', 'pointed', 'loaded'] as Category[]) {
  while (found[cat].length < PER_KIND) {
    tries++;
    if (tries > 20000) throw new Error('too many tries');
    const p = finish(draw(cat));
    if (!p) continue;
    const def = level({ ...p, id: 'x' });
    const sig = imza(def);
    if (sigs.has(sig)) continue;
    // The level as the game will build it: the same verdicts again through checkLevel.
    const r = checkLevel(def);
    if (!r.solution.stands || r.solution.minMargin < MIN_MARGIN || r.trap.stands || r.par !== def.par) continue;
    sigs.add(sig);
    found[cat].push(p);
    const bare = p.loads ? (holdsUnloaded(p, def.trap) ? ' trap holds unloaded' : '') : '';
    console.log(`${cat} ${found[cat].length}: span ${p.span} rise ${def.rise.toFixed(3)} courses ${p.stones} ` +
      `loads ${p.loads?.length ?? 0} ${r.holding}/${r.closed} par ${r.par} margin ${r.solution.minMargin.toFixed(3)}${bare}`);
  }
}
const pool: Pooled[] = [];
for (let i = 0; i < PER_KIND; i++) pool.push(found.semicircle[i], found.pointed[i], found.loaded[i]);

const body = pool.map(p => '  ' + JSON.stringify(p)).join(',\n');
writeFileSync(new URL('../src/levels/daily-pool.ts', import.meta.url), `// Generated by scripts/daily-pool.ts (seed ${SEED}); do not edit by hand, run the script again.
// ${pool.length} daily levels, each checked by the solver when it was generated (and again by the tests):
// semicircle, pointed and loaded in turn. Thicknesses are fractions of the centering radius, as in LevelSpec.
import type { LevelSpec } from './index.js';

export const DAILY_POOL: Omit<LevelSpec, 'id'>[] = [
${body},
];
`);
console.log(`${pool.length} levels from ${tries} tries in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

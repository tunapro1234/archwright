// Prints, for every level, how its solution and trap fare under the solver and how many of all the
// ways to close its arch actually hold. Exits non-zero if a level is broken. Run: npm run level-check
import { LEVELS } from '../src/levels/index.ts';
import { checkLevel } from '../src/levels/search.ts';

const f = (x: number) => (Number.isNaN(x) ? '-' : x.toFixed(3));
const rows: string[][] = [['level', 'courses', 'stones', 'solution', 'margin', 'trap', 'trap margin', 'holding / closed', 'par', 'best margin']];
let bad = 0;
for (const def of LEVELS) {
  const r = checkLevel(def);
  const problems: string[] = [];
  if (!r.solution.stands) problems.push('solution falls');
  if (r.trap.stands) problems.push('trap holds');
  if (r.par !== def.par) problems.push(`par is ${r.par}, level says ${def.par}`);
  if (problems.length) { bad++; console.error(`${def.id}: ${problems.join(', ')}`); }
  rows.push([
    def.id,
    String(def.stones),
    String(def.solution.length),
    r.solution.stands ? 'holds' : 'FALLS',
    f(r.solution.minMargin),
    r.trap.stands ? 'HOLDS' : `falls (${r.trap.failure})`,
    f(r.trap.minMargin),
    `${r.holding} / ${r.closed}`,
    String(r.par),
    f(r.bestMargin),
  ]);
}
const w = rows[0].map((_, c) => Math.max(...rows.map(r => r[c].length)));
for (const [i, r] of rows.entries()) {
  console.log(r.map((v, c) => v.padEnd(w[c])).join('  ').trimEnd());
  if (i === 0) console.log(w.map(n => '-'.repeat(n)).join('  '));
}
if (bad) process.exitCode = 1;

// Runs every browser check in this folder one after another and prints one summary line each.
// Exit code = number of checks that failed. Options (--base, --gpu, --out, --commit) are passed on to every check.
// Each check's full output goes to <out>/logs/<check>.log; a failing check's FAIL lines are printed under its summary.
// Environment: BROWSER_CHECK_TIMEOUT_S (default 1200) stops a check that runs longer.
// Run from the repo root after `npm run build`: npm run browser-check   (or node scripts/browser/run-all.mjs [options])
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONS, REPO } from './launch.mjs';

const CHECKS = ['e2e', 'desktop', 'first-minute', 'xr', 'xr-room', 'xr-hand', 'perf'];
const HERE = fileURLToPath(new URL('.', import.meta.url));
const TIMEOUT_S = Number(process.env.BROWSER_CHECK_TIMEOUT_S) || 1200;
const logDir = join(OPTIONS.out, 'logs');
mkdirSync(logDir, { recursive: true });
const show = p => relative(process.cwd(), p) || '.';
// Pass the options on, with --out made absolute (the checks run with the repo root as cwd).
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
if (outAt >= 0 && args[outAt + 1] && !args[outAt + 1].startsWith('--')) args[outAt + 1] = OPTIONS.out;

let failed = 0;
for (const name of CHECKS) {
  const log = join(logDir, `${name}.log`);
  const t0 = Date.now();
  const rc = await new Promise(resolve => {
    const out = createWriteStream(log);
    const child = spawn(process.execPath, [join(HERE, `${name}.mjs`), ...args], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_S * 1000);
    child.on('close', (code, signal) => { clearTimeout(timer); out.end(() => resolve(code ?? (signal ? 128 : 1))); });
  });
  const text = readFileSync(log, 'utf8');
  const lines = text.split('\n');
  const passed = lines.filter(l => l.startsWith('ok  ')).length;
  const fails = lines.filter(l => l.startsWith('FAIL'));
  const seconds = Math.round((Date.now() - t0) / 1000);
  const ok = rc === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(13)} ${String(passed).padStart(2)} ok, ${fails.length} FAIL, rc=${rc}${rc === 124 ? ' (timed out)' : ''}, ${seconds} s   log: ${show(log)}`);
  if (!ok) for (const l of fails.slice(0, 8)) console.log('     ' + l);
}
console.log(`${CHECKS.length - failed}/${CHECKS.length} checks passed; reports in ${show(OPTIONS.out)}`);
process.exit(failed);

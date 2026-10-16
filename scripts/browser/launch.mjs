// Shared helpers for the browser checks in this folder: command-line options, the static server for dist/,
// the Chromium launch and the git commit written into the reports.
//
// Default: headless Chromium with no GPU process (--disable-gpu); WebGL runs in software (SwiftShader), so the checks
// run the same on a machine without a GPU. Options, accepted by every script and by run-all.mjs:
//   --base <url>     do not start `vite preview`; test the build served at this address instead
//   --gpu [<exe>]    use the real GPU (ANGLE D3D11, as on Windows); <exe> = path of the Chromium/Chrome binary to launch
//   --out <dir>      directory for reports and screenshots (created if missing); default browser-reports/ at the repo root
//   --commit <sha>   commit to write into the reports; default `git rev-parse --short HEAD`
// Environment: BROWSER_CHECK_RENICE=1 keeps every child process at nice 19 (useful on a shared machine).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (scripts/browser/../..); the static server and git run here, whatever the cwd. */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
export const CHROMIUM_ARGS = ['--disable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/** Command-line options. */
export function parseOptions(argv = process.argv.slice(2)) {
  const value = name => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
  const out = value('--out') ? resolve(value('--out')) : join(REPO, 'browser-reports');
  mkdirSync(out, { recursive: true });
  const base = value('--base');
  return {
    base: base && !base.endsWith('/') ? base + '/' : base,
    gpu: argv.includes('--gpu'),
    exe: value('--gpu'),
    out,
    commit: value('--commit'),
  };
}
export const OPTIONS = parseOptions();

/** Path of a file in the output directory. */
export const outPath = name => join(OPTIONS.out, name);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The commit and the tracked files with uncommitted changes, or nulls outside a git checkout. */
export function gitInfo() {
  let commit = OPTIONS.commit, uncommitted = null;
  try {
    commit ??= execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    uncommitted = execFileSync('git', ['status', '--porcelain', '-uno'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean).map(l => l.slice(3));
  } catch {}
  return { commit: commit ?? null, uncommitted };
}

/**
 * Serves dist/ with `vite preview` on the given port (each script has its own), unless --base was given.
 * close() can safely be called more than once. SIGTERM/SIGINT stop the server and exit with 124.
 */
export function startServer(port) {
  if (OPTIONS.base) return { BASE: OPTIONS.base, close() {} };
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: REPO, stdio: 'ignore', detached: true });
  const close = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { close(); process.exit(124); });
  return { BASE: `http://127.0.0.1:${port}/archwright/`, close };
}

/** Waits up to 30 s for the page at BASE to answer; true when it did. */
export async function waitForServer(BASE) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) return true; } catch {} await sleep(500); }
  return false;
}

function descendants() {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,ni=']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const mine = new Set([process.pid]);
  for (let d = 0; d < 8; d++) for (const [pid, ppid] of rows) if (mine.has(ppid)) mine.add(pid);
  return rows.filter(([pid, , ni]) => pid !== process.pid && mine.has(pid) && ni < 19).map(([pid]) => String(pid));
}
function lowerPriority() {
  try { const p = descendants(); if (p.length) execFileSync('renice', ['--priority', '19', '-p', ...p], { stdio: 'ignore' }); } catch {}
}

/** Launches headless Chromium (Playwright): software WebGL by default, the real GPU with --gpu. */
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  if (OPTIONS.gpu) return chromium.launch({ args: GPU_ARGS, ...(OPTIONS.exe ? { executablePath: OPTIONS.exe } : {}) });
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  if (process.env.BROWSER_CHECK_RENICE === '1') {
    // Chromium raises the priority of some helper processes after launch, so one renice is not enough: repeat it.
    lowerPriority();
    const timer = setInterval(lowerPriority, 2000);
    timer.unref();
    browser.on('disconnected', () => clearInterval(timer));
  }
  return browser;
}

/** Collects console errors and uncaught page errors of a page. */
export function collectErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

/** Prints up to five collected errors under a result line. */
export function printErrors(errors) {
  if (errors.length) console.log('     ' + errors.slice(0, 5).join('\n     '));
}

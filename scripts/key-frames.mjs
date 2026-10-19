// Seven key frames of w1-1 from the emulator page, in one short run: the tray, the keystone held
// over its gap with the snap ghost, the keystone seated, the centering being pulled, the arch
// holding, the collapse half way, the collapse at rest.
// Usage: node scripts/key-frames.mjs <out-dir>   (needs a fresh `npm run build`)
// Writes <out-dir>/dilim-<name>.png. Desktop view with IWER installed, not a headset capture.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const outDir = resolve(process.argv[2] ?? '.');
const SHOTS = ['tray', 'ghost', 'keystone', 'pulling', 'held', 'collapse-mid', 'collapsed'];
const PORT = 4794;
const BASE = `http://127.0.0.1:${PORT}/archwright/`;
const wait = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ } };
process.on('SIGTERM', () => { stopServer(); process.exit(124); });

/** Chromium raises its GPU process priority; put every descendant of this script back to nice 19. */
function lowerPriority() {
  try {
    const rows = execFileSync('ps', ['-eo', 'pid=,ppid=']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
    const mine = new Set([process.pid]);
    for (let d = 0; d < 6; d++) for (const [pid, ppid] of rows) if (mine.has(ppid)) mine.add(pid);
    mine.delete(process.pid);
    if (mine.size) execFileSync('renice', ['--priority', '19', '-p', ...[...mine].map(String)], { stdio: 'ignore' });
  } catch { /* best effort */ }
}

let failed = false;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    await wait(500);
  }
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  lowerPriority();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}?emulator=1&shots=1&autotest=w1-1:hold;w1-1:collapse`);
  lowerPriority();

  // Straight from the compositor: page.screenshot() waits for a fresh animation frame, which software
  // WebGL may not deliver within its timeout.
  const cdp = await page.context().newCDPSession(page);
  const taken = [];
  const t0 = Date.now();
  while (taken.length < SHOTS.length && Date.now() - t0 < 480_000) {
    const shot = await page.evaluate(() => window.__archwright?.shot ?? null);
    if (shot && taken.includes(shot)) {
      // Each run holds at its own key frames; the hold run's are kept, the collapse run's repeats are passed.
      await page.evaluate(() => { window.__archwright.shot = undefined; });
    } else if (shot) {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // two frames drawn in the hold
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      writeFileSync(join(outDir, `dilim-${shot}.png`), Buffer.from(data, 'base64'));
      taken.push(shot);
      console.log(`${shot} at ${((Date.now() - t0) / 1000).toFixed(1)} s, state=${await page.evaluate(() => window.__archwright.state)}`);
      await page.evaluate(() => { window.__archwright.shot = undefined; });
    } else await wait(200);
  }
  const missing = SHOTS.filter(s => !taken.includes(s));
  console.log(JSON.stringify({ taken, missing, consoleErrors: errors.length, perf: await page.evaluate(() => window.__archwright.perf) }));
  if (errors.length) console.log(errors.slice(0, 5).join('\n'));
  failed = missing.length > 0 || errors.length > 0;
  await browser.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  stopServer();
}
process.exit(failed ? 1 : 0);

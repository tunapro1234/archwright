// Desktop mouse mode: solves w1-1 with real mouse events (page.mouse) and drags the centering lever down. No autotest.
// Uses the hook described in README: __archwright.project(target) → {x, y} in CSS px | null
// (target = stone id | 'face:left' | 'face:right' | 'lever'), __archwright.placed (count), __archwright.debug.solution (steps).
// Passes when every stone of the solution seats, the pulled centering ends in state 'held' and there is no console error.
// Run from the repo root after `npm run build`: node scripts/browser/desktop.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>]
// Writes desktop-closed.png (arch closed) and desktop-<state>.png to the output directory.
import { collectErrors, launchBrowser, outPath, printErrors, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4792);
let failures = 0;
try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = collectErrors(page);
  await page.goto(`${BASE}?level=w1-1`, { timeout: 180000 });
  const get = (f, a) => page.evaluate(f, a);
  const waitFor = async (f, what, seconds = 60, arg) => {
    for (let i = 0; i < seconds * 2; i++) { const v = await get(f, arg); if (v) return v; await sleep(500); }
    throw new Error('timed out: ' + what);
  };
  await waitFor(() => ['ready', 'building'].includes(window.__archwright?.state), 'scene ready');
  const solution = await get(() => window.__archwright?.debug?.solution ?? null);
  if (!Array.isArray(solution) || !solution.length) throw new Error('__archwright.debug.solution missing');
  const point = async target => {
    const p = await get(t => window.__archwright.project(t), target);
    if (!p || !(p.x >= 0 && p.x <= 1280 && p.y >= 0 && p.y <= 720)) throw new Error(`project(${target}) is off screen: ${JSON.stringify(p)}`);
    return p;
  };
  for (const [i, step] of solution.entries()) {
    const before = await get(() => window.__archwright.placed);
    const s = await point(step.stone); await page.mouse.click(s.x, s.y); await sleep(400);
    const f = await point('face:' + step.side); await page.mouse.click(f.x, f.y);
    await waitFor(n => window.__archwright.placed === n, `stone ${i + 1} (${step.stone} → ${step.side}) did not seat`, 60, before + 1);
    console.log(`ok   mouse: ${step.stone} → ${step.side}`);
  }
  await page.screenshot({ path: outPath('desktop-closed.png'), timeout: 120000 });
  const lever = await point('lever');
  await page.mouse.move(lever.x, lever.y); await page.mouse.down();
  for (let s = 1; s <= 12; s++) { await page.mouse.move(lever.x, lever.y + s * 15); await sleep(150); }
  await page.mouse.up();
  const final = await waitFor(() => ['held', 'collapsed'].includes(window.__archwright.state) && window.__archwright.state, 'verdict after pulling the centering', 120);
  await sleep(1500);
  await page.screenshot({ path: outPath(`desktop-${final}.png`), timeout: 120000 });
  const ok = final === 'held' && errors.length === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} w1-1 by mouse: state=${final} console_errors=${errors.length}`);
  printErrors(errors);
  if (!ok) failures++;
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; }
finally { close(); }
process.exit(failures ? 1 : 0);

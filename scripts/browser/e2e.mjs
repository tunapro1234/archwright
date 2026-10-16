// End-to-end check in a desktop browser: `?emulator=1&autotest=w1-1:hold` must end in state 'held' and
// `autotest=w1-1:collapse` in 'collapsed', with every perf number present and no console error.
// Run from the repo root after `npm run build`: node scripts/browser/e2e.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>]
// Writes e2e-hold.png and e2e-collapse.png to the output directory.
import { collectErrors, launchBrowser, outPath, printErrors, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4791);
let failures = 0;
try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  for (const [target, expected] of [['hold', 'held'], ['collapse', 'collapsed']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = collectErrors(page);
    const level = 'w1-1';
    await page.goto(`${BASE}?emulator=1&autotest=${level}:${target}`, { timeout: 180000 });
    let state = null;
    for (let i = 0; i < 120; i++) { state = await page.evaluate(() => window.__archwright?.state ?? null); if (state === expected) break; await sleep(500); }
    const perf = await page.evaluate(() => window.__archwright?.perf ?? null);
    await page.screenshot({ path: outPath(`e2e-${target}.png`), timeout: 120000 });
    const ok = state === expected && perf && ['fps', 'frameMs', 'drawCalls', 'triangles', 'bodies'].every(k => typeof perf[k] === 'number') && errors.length === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} autotest ${target}: state=${state} perf=${JSON.stringify(perf)} console_errors=${errors.length}`);
    printErrors(errors);
    if (!ok) failures++;
    await page.close();
  }
  await browser.close();
} catch (e) { console.error('FAIL', e); failures++; }
finally { close(); }
process.exit(failures ? 1 : 0);

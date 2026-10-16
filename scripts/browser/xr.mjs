// XR smoke check with IWER, Meta's WebXR emulator (?emulator=1): the page enters a real XR session on its own
// (?autoxr=ar|vr, no click). Reads window.__archwright.xr = { mode: 'immersive-ar'|'immersive-vr'|null, features: string[] }.
//   AR + autotest=w1-1:hold: mode immersive-ar, the board ends on lap|plane|mesh|pick, state held.
//   VR: mode immersive-vr, the board ends in the atelier.
// No console error in either. Run from the repo root after `npm run build`:
//   node scripts/browser/xr.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>]
// Writes xr-ar.png and xr-vr.png to the output directory.
import { collectErrors, launchBrowser, outPath, printErrors, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4793);
let failures = 0;
const CASES = [
  // [name, query, expected mode, accepted surfaces, expected state]
  ['ar', '?emulator=1&autoxr=ar&autotest=w1-1:hold', 'immersive-ar', ['lap', 'plane', 'mesh', 'pick'], 'held'],
  ['vr', '?emulator=1&autoxr=vr&level=w1-1', 'immersive-vr', ['atelier'], null],
];
try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  for (const [name, query, mode, surfaces, expectedState] of CASES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = collectErrors(page);
    try {
      await page.goto(BASE + query, { timeout: 180000 });
      const waitFor = async (f, seconds, arg) => { for (let i = 0; i < seconds * 2; i++) { const v = await page.evaluate(f, arg); if (v) return v; await sleep(500); } return null; };
      const xr = await waitFor(() => window.__archwright?.xr?.mode ? window.__archwright.xr : null, 120);
      // The surface chain falls back to the lap tray 9.5 s after the session starts; wait 15 s.
      const surface = await waitFor(() => { const a = window.__archwright; return a?.xr?.mode && a.surface && a.surface !== 'desk' ? a.surface : null; }, 60);
      await sleep(15000);
      const lastSurface = await page.evaluate(() => window.__archwright?.surface ?? null);
      const state = expectedState ? await waitFor(s => window.__archwright?.state === s && s, 180, expectedState) : null;
      await page.screenshot({ path: outPath(`xr-${name}.png`), timeout: 120000 });
      const ok = xr?.mode === mode && Array.isArray(xr.features) && surfaces.includes(lastSurface) && (!expectedState || state === expectedState) && errors.length === 0;
      console.log(`${ok ? 'ok  ' : 'FAIL'} XR ${name}: mode=${xr?.mode ?? null} features=${JSON.stringify(xr?.features ?? null)} surface=${surface}→${lastSurface} state=${state ?? '-'} console_errors=${errors.length}`);
      printErrors(errors);
      if (!ok) failures++;
    } catch (e) { console.error(`FAIL XR ${name}:`, e.message ?? e); failures++; }
    await page.close();
  }
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; }
finally { close(); }
process.exit(failures ? 1 : 0);

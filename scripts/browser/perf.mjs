// Performance budget check. Budget: draw calls ≤ 60 (≤ 100 while an arch collapses), visible triangles ≤ 100k,
// dynamic physics bodies ≤ 40. __archwright.perf is written every frame from renderer.info; each case samples it for the
// whole window and keeps the worst value.
// Environment: headless Chromium, SwiftShader software WebGL (or the real GPU with --gpu), IWER emulator for XR.
// Draw calls, triangles and bodies do not depend on the device; frame time and fps are numbers of THIS environment,
// not of a Quest. The budget is asserted only for the desktop cases; XR rows are recorded (without multiview each eye is
// drawn separately, so the count covers both eyes).
// Run from the repo root after `npm run build`:
//   node scripts/browser/perf.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>] [--commit <sha>]
// Writes perf.json, perf.md and perf-<case>.png to the output directory.
import { writeFileSync } from 'node:fs';
import { OPTIONS, collectErrors, gitInfo, launchBrowser, outPath, printErrors, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4798);
const BUDGET = { drawCalls: 60, drawCallsCokus: 100, triangles: 100000, bodies: 40 }; // drawCallsCokus: while collapsing

// Full museum: a progress record with every level of the three worlds solved (STORAGE_KEY format of src/game/progress.ts).
const allLevels = [1, 2, 3].flatMap(w => [1, 2, 3, 4, 5].map(i => `w${w}-${i}`));
const fullProgress = JSON.stringify({ solved: Object.fromEntries(allLevels.map(id => [id, { stones: 5, at: '2026-10-12' }])), current: 'w3-5' });

const CASES = [
  // [name, query, state to wait for, collapse case, XR, full museum]
  ['desktop-w1-1', '?level=w1-1', 'ready', false, false, false],
  ['desktop-w3-5-holds', '?autotest=w3-5:hold', 'held', false, false, false],
  ['desktop-w3-5-collapse', '?autotest=w3-5:collapse', 'collapsed', true, false, false],
  ['desktop-full-museum', '?level=w3-5', 'ready', false, false, true],
  ['xr-vr-w3-5-collapse', '?emulator=1&autoxr=vr&autotest=w3-5:collapse', 'collapsed', true, true, true],
];
// The report keeps its original field names so results stay comparable with earlier runs:
// sonuclar = results, ad = case, sorgu = query, ornek = samples, frameMsOrt / frameMsOrtanca = mean / median frame ms,
// fpsOrt = mean fps, konsolHata = console errors, butce = budget verdict; top level: tarih = date, not = note, ortam = environment.
const results = [];
let failures = 0;
try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  for (const [name, query, expectedState, collapse, xr, museum] of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (museum) await ctx.addInitScript(k => { try { localStorage.setItem('archwright.progress.v1', k); } catch {} }, fullProgress);
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    try {
      await page.goto(BASE + query, { timeout: 180000 });
      // Sample while waiting too: the busiest moment of a collapse comes before the state turns 'collapsed'.
      const samples = [];
      let state = null;
      for (let i = 0; i < 480 && state !== expectedState; i++) {
        const v = await page.evaluate(() => { const a = window.__archwright; return a ? { state: a.state, mode: a.xr?.mode ?? null, ...a.perf } : null; });
        if (v) { state = v.state; if (v.drawCalls > 0) samples.push(v); }
        await sleep(500);
      }
      for (let i = 0; i < 12; i++) { const v = await page.evaluate(() => ({ state: window.__archwright.state, mode: window.__archwright.xr?.mode ?? null, ...window.__archwright.perf })); if (v.drawCalls > 0) samples.push(v); await sleep(250); }
      await page.screenshot({ path: outPath(`perf-${name}.png`), timeout: 120000 });
      const max = k => Math.max(0, ...samples.map(o => o[k]));
      // Median: a few long frames while loading (shader compilation, Havok WASM) should not skew the figure.
      const median = k => { const v = samples.map(o => o[k]).sort((a, b) => a - b); return v.length ? +v[v.length >> 1].toFixed(2) : null; };
      const mean = k => samples.length ? +(samples.reduce((s, o) => s + o[k], 0) / samples.length).toFixed(2) : null;
      const r = {
        ad: name, sorgu: query, state, xr: samples.at(-1)?.mode ?? null, ornek: samples.length,
        drawCallsMax: max('drawCalls'), trianglesMax: max('triangles'), bodiesMax: max('bodies'),
        frameMsOrt: mean('frameMs'), frameMsOrtanca: median('frameMs'), fpsOrt: mean('fps'), konsolHata: errors.length,
      };
      const dcLimit = collapse ? BUDGET.drawCallsCokus : BUDGET.drawCalls;
      const withinBudget = xr || (r.drawCallsMax <= dcLimit && r.trianglesMax <= BUDGET.triangles && r.bodiesMax <= BUDGET.bodies);
      r.butce = xr ? 'recorded (XR, not asserted)' : withinBudget ? 'within' : 'OVER';
      const ok = state === expectedState && samples.length > 0 && errors.length === 0 && withinBudget && (!xr || r.xr === 'immersive-vr');
      console.log(`${ok ? 'ok  ' : 'FAIL'} perf ${name}: state=${state} dc=${r.drawCallsMax}/${dcLimit} tri=${r.trianglesMax} bodies=${r.bodiesMax} frameMs≈${r.frameMsOrtanca} (${OPTIONS.gpu ? 'GPU' : 'software'}) console_errors=${errors.length}`);
      printErrors(errors);
      results.push(r);
      if (!ok) failures++;
    } catch (e) { console.error(`FAIL perf ${name}:`, e.message ?? e); failures++; }
    await ctx.close();
  }
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; }
finally { close(); }

const commit = gitInfo().commit ?? '?';
const note = OPTIONS.gpu ? 'desktop GPU Chromium, not a Quest measurement' : 'SwiftShader software WebGL, not a Quest measurement';
const environment = OPTIONS.gpu
  ? 'headless Chromium (Playwright), ANGLE D3D11 on a desktop GPU, IWER emulator for XR; not a Quest, no headset'
  : 'headless Chromium (Playwright), SwiftShader software WebGL, IWER emulator for XR; no GPU, no headset';
writeFileSync(outPath('perf.json'), JSON.stringify({ commit, tarih: new Date().toISOString(), not: note, ortam: environment, butce: BUDGET, sonuclar: results }, null, 2) + '\n');
const rows = results.map(r => `| ${r.ad} | ${r.state} | ${r.drawCallsMax} | ${r.trianglesMax} | ${r.bodiesMax} | ${r.frameMsOrtanca ?? '-'} | ${r.butce} |`);
writeFileSync(outPath('perf.md'), [
  `# Performance budget check (commit ${commit})`, '',
  `Environment: ${environment}.`,
  'Draw calls, triangles and physics bodies do not depend on the device.',
  OPTIONS.gpu
    ? 'Frame times here come from a desktop GPU and say nothing about a Quest. This is not a headset measurement.'
    : 'Frame times here come from a software renderer and say nothing about a Quest; they are listed only for completeness. This is not a headset measurement.', '',
  `Budget: draw calls ≤ ${BUDGET.drawCalls} (≤ ${BUDGET.drawCallsCokus} while an arch collapses), visible triangles ≤ ${BUDGET.triangles / 1000}k, dynamic bodies ≤ ${BUDGET.bodies}.`,
  'XR rows are recorded, not asserted: without multiview each eye is drawn separately, so the count covers both eyes.', '',
  `| Case | State | Draw calls (max) | Triangles (max) | Bodies (max) | Frame ms (${OPTIONS.gpu ? 'desktop GPU' : 'software'}, median) | Budget |`,
  '|---|---|---|---|---|---|---|', ...rows, '',
].join('\n'));
console.log(`report: ${outPath('perf.json')}`);
process.exit(failures ? 1 : 0);

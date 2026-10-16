// First minute, browser half: the wordless lesson.
//   Empty storage, w1-1 on the desktop: the ghost hand plays (__archwright.onboard.cue 'ghost-grab', ghostShown ≥ 1).
//   Lesson already finished (saved in archwright.onboard.v1): no cue at all for 20 s.
//   Empty storage, w1-1 in an emulated VR session: the ghost hand plays there too.
// No console error in any case. Run from the repo root after `npm run build`:
//   node scripts/browser/first-minute.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>] [--commit <sha>]
// Writes first-minute.json and first-minute-<case>.png to the output directory.
import { writeFileSync } from 'node:fs';
import { collectErrors, gitInfo, launchBrowser, outPath, printErrors, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4799);
const screenshot = (page, name) => page.screenshot({ path: outPath(`first-minute-${name}.png`), timeout: 120000 });
const FINISHED = JSON.stringify({ ghostShown: 3, grabbed: true, struck: true, idleS: 0 });
const CASES = [
  // [name, query, saved lesson state, ghost expected]
  ['desktop-first', '?level=w1-1', null, true],
  ['desktop-finished', '?level=w1-1', FINISHED, false],
  ['xr-vr-first', '?emulator=1&autoxr=vr&level=w1-1', null, true],
];
// The report keeps its original field names so results stay comparable with earlier runs:
// sonuclar = results, ad = case, hayalet = ghost seen, son = last onboard hook, konsolHata = console errors,
// konsolIlk = first console errors, hata = error.
const results = [];
let failures = 0;
try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  for (const [name, query, saved, ghostExpected] of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    if (saved) await ctx.addInitScript(k => { try { localStorage.setItem('archwright.onboard.v1', k); } catch {} }, saved);
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    try {
      await page.goto(BASE + query, { timeout: 180000 });
      let seen = false, last = null, shot = false;
      for (let i = 0; i < 240; i++) {  // at most 2 min (software WebGL is slow)
        last = await page.evaluate(() => window.__archwright?.onboard ?? null);
        if (last?.cue === 'ghost-grab' && !shot) { await sleep(1500); await screenshot(page, name); shot = true; }
        if (last?.cue === 'ghost-grab') seen = true;
        if (ghostExpected && seen && last?.ghostShown >= 1) break;
        if (!ghostExpected && i >= 40) break;  // no cue may appear for 20 s
        await sleep(500);
      }
      if (!shot) await screenshot(page, name);
      const ok = last !== null && (ghostExpected ? seen && last.ghostShown >= 1 : !seen && last.cue === 'none') && errors.length === 0;
      console.log(`${ok ? 'ok  ' : 'FAIL'} first-minute ${name}: ghost=${seen} last=${JSON.stringify(last)} console_errors=${errors.length}`);
      printErrors(errors);
      results.push({ ad: name, ok, hayalet: seen, son: last, konsolHata: errors.length, konsolIlk: errors.slice(0, 3).map(k => k.slice(0, 300)) });
      if (!ok) failures++;
    } catch (e) { console.error(`FAIL first-minute ${name}:`, e.message ?? e); results.push({ ad: name, ok: false, hata: String(e.message ?? e).slice(0, 300) }); failures++; }
    await ctx.close();
  }
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; }
finally { close(); }
writeFileSync(outPath('first-minute.json'), JSON.stringify({ rc: failures ? 1 : 0, commit: gitInfo().commit, sonuclar: results }, null, 1) + '\n');
console.log(`report: ${outPath('first-minute.json')}`);
process.exit(failures ? 1 : 0);

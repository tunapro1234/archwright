// XR emulated hand check: the hand-joint pinch path (src/systems/hands.ts → grab-snap.ts → centering.ts) driven by
// IWER's right hand (primaryInputMode 'hand'), which really grabs and seats the stones and pulls the centering. No autotest.
// The hand is moved by the in-page driver ?handplay=solution|trap (src/systems/handplay.ts): it only changes the IWER
// hand's position and pinch value, and reads stone/face/lever positions from the game. The game reads the hand from the
// WebXR joints (thumb tip + index finger tip); grabbing, seating and striking are the game's own code. The driver does not
// tie its own bookkeeping to a scene: at the end this check reads the game's state (__archwright.state, seated stones) separately.
//   A) AR + synthetic office (?room=office_small, the table is found), w1-1 solution: the stones seat, the pulled centering → held.
//   B) VR (atelier, opaque; the hand model is drawn), w1-1 trap: the arch closes, the pulled centering → collapsed.
// Run from the repo root after `npm run build`:
//   node scripts/browser/xr-hand.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>] [--commit <sha>]
// Writes xr-hand.json, xr-hand.png (end of A) and xr-hand-vr.png (B, while a stone is carried in the hand).
import { writeFileSync } from 'node:fs';
import { gitInfo, launchBrowser, outPath, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4805);
const query = (mode, plan) => `?emulator=1&autoxr=${mode}${mode === 'ar' ? '&room=office_small' : ''}&level=w1-1&handplay=${plan}`;

const { commit, uncommitted } = gitInfo();
const result = { commit, uncommitted, driver: 'src/systems/handplay.ts (IWER right hand: position + pinch value only)', runs: {} };
let failures = 0;
const check = (ok, s) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${s}`); if (!ok) failures++; };

async function run(browser, name, mode, plan, expected, png) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [], warnings = [], otherOrigin = [];
  const host = new URL(BASE).hostname;
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).hostname !== host) otherOrigin.push(r.url()); });
  const waitFor = async (f, seconds, arg) => { for (let i = 0; i < seconds * 2; i++) { const v = await page.evaluate(f, arg).catch(() => null); if (v) return v; await sleep(500); } return null; };
  const read = () => page.evaluate(() => {
    const a = window.__archwright;
    return a ? { state: a.state, level: a.level, placed: a.placed ?? null, surface: a.surface ?? null, board: a.board ?? null, xr: a.xr ?? null, handplay: a.handplay ? { ...a.handplay, misses: [...a.handplay.misses] } : null, onboard: a.onboard ?? null } : null;
  });
  const t0 = Date.now();
  const q = query(mode, plan);
  await page.goto(BASE + q, { timeout: 180000 });
  const xr = await waitFor(() => window.__archwright?.xr?.mode ? window.__archwright.xr : null, 120);
  // In hand mode the input sources must be hand profiles (not controllers).
  const inputs = await waitFor(() => { const i = window.__archwright?.xr?.inputs ?? []; return i.length ? i : null; }, 30);
  let frame = null;
  if (png === 'carry') {
    // B: one frame while the first stone is carried in the hand (the hand model is visible).
    frame = await waitFor(() => window.__archwright?.handplay?.phase === 'carry' && window.__archwright.handplay.step === 0 ? true : null, 240);
    if (frame) await page.screenshot({ path: outPath('xr-hand-vr.png'), timeout: 120000 });
  }
  const finished = await waitFor(() => { const h = window.__archwright?.handplay; return h && (h.phase === 'done' || h.phase === 'failed') ? h.phase : null; }, 420);
  const verdict = await waitFor(() => ['held', 'collapsed'].includes(window.__archwright?.state) ? window.__archwright.state : null, 120);
  await sleep(1500);
  const end = await read();
  if (png === 'end') await page.screenshot({ path: outPath('xr-hand.png'), timeout: 120000 });
  const hp = end?.handplay;
  const r = {
    url: q, mode: xr?.mode ?? null, features: xr?.features ?? null, inputs: inputs ?? end?.xr?.inputs ?? null,
    surface: end?.surface ?? null, board: end?.board ?? null,
    plan, steps: hp?.steps ?? null, grabbed: hp?.grabbed ?? 0, seated: hp?.seated ?? 0, stonesOnArch: end?.placed ?? null,
    struck: hp?.struck ?? false, pulled: hp?.pull ?? null, handplayPhase: finished, misses: hp?.misses ?? [],
    state: verdict, expected, onboard: end?.onboard ?? null, seconds: Math.round((Date.now() - t0) / 1000),
    consoleErrors: errors.length, consoleSample: errors.slice(0, 5), consoleWarnings: warnings.slice(0, 5), otherOriginRequests: otherOrigin,
  };
  result.runs[name] = r;
  check(r.mode === (mode === 'ar' ? 'immersive-ar' : 'immersive-vr'), `${name}: mode=${r.mode}, inputs ${JSON.stringify(r.inputs)}, surface ${r.surface}`);
  check(Array.isArray(r.inputs) && r.inputs.length > 0 && r.inputs.every(p => /hand/.test(p)), `${name}: input sources are hands (${JSON.stringify(r.inputs)})`);
  check(finished === 'done' && r.misses.length === 0, `${name}: the hand grabbed ${r.grabbed} and seated ${r.seated} of ${r.steps} stones (on the arch: ${r.stonesOnArch}); centering ${r.struck ? 'pulled' : 'NOT pulled'} (${r.pulled?.toFixed?.(3)} m); misses ${JSON.stringify(r.misses)}`);
  check(verdict === expected, `${name}: state ${verdict} (expected ${expected}), ${r.seconds} s`);
  check(errors.length === 0, `${name}: console errors ${errors.length}${errors.length ? '\n     ' + errors.slice(0, 5).join('\n     ') : ''}`);
  check(otherOrigin.length === 0, `${name}: requests to another origin ${otherOrigin.length}`);
  if (png === 'carry') check(!!frame, `${name}: carry frame ${frame ? 'xr-hand-vr.png' : 'not captured'}`);
  await ctx.close();
}

try {
  if (!(await waitForServer(BASE))) throw new Error('server did not start');
  const browser = await launchBrowser();
  await run(browser, 'arRoomSolution', 'ar', 'solution', 'held', 'end');
  await run(browser, 'vrTrap', 'vr', 'trap', 'collapsed', 'carry');
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; result.error = String(e.message ?? e); }
finally { close(); }
result.ok = failures === 0;
writeFileSync(outPath('xr-hand.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`report: ${outPath('xr-hand.json')}`);
process.exit(failures ? 1 : 0);

// XR synthetic room check. IWER plus Meta's synthetic environment module (@iwer/sem, ?room=office_small, the room file
// comes from this site): does the desk-finding chain (src/scene/surface-chain.ts) run on real plane/mesh data, and does
// the museum plinth get a persistent anchor?
//   Session 1: ?emulator=1&autoxr=ar&room=office_small&autotest=w1-1:hold, progress seeded with world 1 solved
//     (so the museum has a 'world:w1' plinth; an anchor is requested only when a plinth exists and the first stone is down).
//     Measured: session mode and enabled features, plane/mesh count and labels, the surface the chain chose, the board's
//     height below the eyes, the autotest result, the anchor requests (requested/created/persisted/failed).
//   Session 2: the page is opened again in the same browser context (no autotest): does the saved anchor come back?
// The emulated headset pose is fixed in src/index.ts (0, 1.15, 0.05): a seated player's eyes; this check does not move it.
// No table found is NOT a failure: the result is written as it is (tableFound=false). An anchor that does not come back is
// not a failure either (restored/lost is written). Exit code 1 on a broken run: a session did not open, the room did not
// load, the autotest did not hold, the restore of a saved anchor never settled, a console error, or a request to another origin.
// Run from the repo root after `npm run build`:
//   node scripts/browser/xr-room.mjs [--base <url>] [--gpu [<exe>]] [--out <dir>] [--commit <sha>]
// Writes xr-room.json and xr-room.png to the output directory.
import { writeFileSync } from 'node:fs';
import { collectErrors, gitInfo, launchBrowser, outPath, sleep, startServer, waitForServer } from './launch.mjs';

const { BASE, close } = startServer(4801);
const ROOM = 'office_small';
const HEADSET = { position: [0, 1.15, 0.05], why: 'src/index.ts: seated eye height; a 75 cm desk is 40 cm below the eyes' };
const W1 = ['w1-1', 'w1-2', 'w1-3', 'w1-4', 'w1-5'];
const seed = JSON.stringify({ solved: Object.fromEntries(W1.map(id => [id, { stones: 5, at: '2026-10-15' }])), current: 'm-tiberio' });
// Commit and the tracked files with uncommitted changes, separately.
const { commit, uncommitted } = gitInfo();

const result = { commit, uncommitted, room: ROOM, headset: HEADSET, url1: `?emulator=1&autoxr=ar&room=${ROOM}&autotest=w1-1:hold`, url2: `?emulator=1&autoxr=ar&room=${ROOM}&level=w1-1` };
let failures = 0;
const check = (ok, s) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${s}`); if (!ok) failures++; };

try {
  await waitForServer(BASE);
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // Seed only on the first load: session 2 must see the progress and anchor records written by session 1.
  await ctx.addInitScript(k => { try { if (!sessionStorage.getItem('xr-room.seeded')) { localStorage.setItem('archwright.progress.v1', k); sessionStorage.setItem('xr-room.seeded', '1'); } } catch {} }, seed);
  const page = await ctx.newPage();
  const errors = collectErrors(page);
  const host = new URL(BASE).hostname;
  const otherOrigin = [];
  page.on('request', r => { if (!/^(data|blob):/.test(r.url()) && new URL(r.url()).hostname !== host) otherOrigin.push(r.url()); });
  const waitFor = async (f, seconds, arg) => { for (let i = 0; i < seconds * 2; i++) { const v = await page.evaluate(f, arg); if (v) return v; await sleep(500); } return null; };
  const hook = () => page.evaluate(() => {
    const a = window.__archwright;
    return a ? { state: a.state, level: a.level, surface: a.surface ?? null, board: a.board ?? null, xr: a.xr ?? null, detected: a.detected ?? null, museum: a.museum ?? null } : null;
  });

  // --- Session 1 ---------------------------------------------------------------------------------
  await page.goto(BASE + result.url1, { timeout: 180000 });
  const xr = await waitFor(() => window.__archwright?.xr?.mode ? window.__archwright.xr : null, 120);
  // The room's planes arrive in the first frames of the session; none within 30 s means the room did not load.
  const det = await waitFor(() => (window.__archwright?.detected?.planes?.length ?? 0) > 0 ? window.__archwright.detected : null, 30);
  // Surface: while the chain waits (pick) it can take up to 9.5 s; once the board sits somewhere, board is written.
  await waitFor(() => window.__archwright?.board && window.__archwright.board.kind !== 'desk', 60);
  const first = await hook();
  const verdict = await waitFor(() => window.__archwright?.state === 'held' || window.__archwright?.state === 'collapsed' ? window.__archwright.state : null, 240);
  // Anchor: requested after the first stone is down; the answer (created or failed) comes on a later frame.
  const anc = await waitFor(() => { const t = window.__archwright?.museum?.anchors; return t && t.requested > 0 && t.created + t.failed >= t.requested && (t.created === 0 || t.persisted >= t.created) ? t : null; }, 30);
  await sleep(1500);
  const end1 = await hook();
  const saved1 = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('archwright.museum.v1') ?? '{}').handles ?? {}; } catch { return {}; } });
  await page.screenshot({ path: outPath('xr-room.png'), timeout: 120000 });
  const tableLabels = ['table', 'desk'];
  const tableInRoom = [...(end1?.detected?.planes ?? []), ...(end1?.detected?.meshes ?? [])].some(l => tableLabels.includes(l));
  result.session1 = {
    mode: xr?.mode ?? null, features: xr?.features ?? null, room: end1?.xr?.room ?? null, inputs: end1?.xr?.inputs ?? null,
    planes: { count: end1?.detected?.planes?.length ?? 0, labels: end1?.detected?.planes ?? [] },
    meshes: { count: end1?.detected?.meshes?.length ?? 0, labels: end1?.detected?.meshes ?? [] },
    surfaceFirst: first?.surface ?? null, surface: end1?.surface ?? null, board: end1?.board ?? null,
    tableInRoom, tableFound: ['mesh', 'plane'].includes(end1?.board?.kind),
    state: verdict, museum: end1?.museum ?? null, anchorRequests: anc ?? end1?.museum?.anchors ?? null,
    savedHandles: Object.keys(saved1),
  };
  check(xr?.mode === 'immersive-ar', `session 1: mode=${xr?.mode ?? null} features=${JSON.stringify(xr?.features ?? null)} room=${end1?.xr?.room ?? null}`);
  check(!!det, `room: ${result.session1.planes.count} planes [${result.session1.planes.labels.join(', ')}], ${result.session1.meshes.count} meshes [${result.session1.meshes.labels.join(', ')}]`);
  console.log(`     surface: ${result.session1.surfaceFirst}→${result.session1.surface}; board ${JSON.stringify(end1?.board)}; table ${result.session1.tableFound ? 'FOUND' : 'not found'}`);
  check(verdict === 'held', `autotest w1-1:hold → ${verdict}`);
  console.log(`     museum: ${JSON.stringify(end1?.museum)}; saved handles: ${result.session1.savedHandles.join(', ') || '-'}`);

  // --- Session 2: same context, page opened again ------------------------------------------------
  await page.goto(BASE + result.url2, { timeout: 180000 });
  const xr2 = await waitFor(() => window.__archwright?.xr?.mode ? window.__archwright.xr.mode : null, 120);
  // A saved anchor must come back within RESTORE_WAIT (3 s of game time, at most 0.1 s per frame: at least 30 frames) or its
  // handle is dropped. With slow software rendering 30 frames can take long: wait 60 s.
  const settled = await waitFor(() => { const t = window.__archwright?.museum?.anchors; return t && t.restored + t.lost > 0; }, 60);
  const end2 = await hook();
  const store2 = await page.evaluate(() => {
    const read = k => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
    return { museum: Object.keys(read('archwright.museum.v1')?.handles ?? {}), emulator: Object.keys(read('@immersive-web-emulation-runtime/persistent-anchors') ?? {}).length };
  });
  result.session2 = {
    mode: end2?.xr?.mode ?? null, restoreSettled: !!settled, museum: end2?.museum ?? null, restored: end2?.museum?.anchors?.restored ?? 0,
    lost: end2?.museum?.anchors?.lost ?? 0, savedHandles: store2.museum, emulatorStoredAnchors: store2.emulator,
  };
  check(xr2 === 'immersive-ar', `session 2: mode=${xr2 ?? null}`);
  console.log(`     session 2: museum ${JSON.stringify(end2?.museum)}; restored ${result.session2.restored}, lost ${result.session2.lost}; saved handles [${store2.museum.join(', ')}], ${store2.emulator} anchors in the emulator's store`);
  // If session 1 saved a handle, session 2 must either restore it or report it lost; neither means the restore never ran.
  // (An anchor that does not come back is a result, not a failure; staying silent is a failure.)
  if (result.session1.savedHandles.length) check(result.session2.restoreSettled, `session 2: saved anchor ${result.session2.restored ? 'restored' : result.session2.lost ? 'lost' : 'neither restored nor dropped within 60 s'}`);

  result.consoleErrors = errors.length;
  result.consoleSample = errors.slice(0, 5);
  result.otherOriginRequests = otherOrigin;
  check(errors.length === 0, `console errors ${errors.length}${errors.length ? '\n     ' + errors.slice(0, 5).join('\n     ') : ''}`);
  check(otherOrigin.length === 0, `requests to another origin ${otherOrigin.length}${otherOrigin.length ? ': ' + otherOrigin.slice(0, 3).join(' ') : ''}`);
  await browser.close();
} catch (e) { console.error('FAIL', e.message ?? e); failures++; result.error = String(e.message ?? e); }
finally { close(); }
result.ok = failures === 0;
writeFileSync(outPath('xr-room.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`report: ${outPath('xr-room.json')}`);
process.exit(failures ? 1 : 0);

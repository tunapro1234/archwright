// First-load size of the built site (run after `vite build`; `npm run build` does it).
// Counts what a desktop or headset visit can download before the first stone goes down: dist/
// minus what only loads on demand: Havok's physics (WASM and its worker/runtime chunks, fetched when
// the first stone is placed), the IWER emulator chunk (?emulator=1 only), the controller and hand
// input profiles (only when an XR input asks for its model), source maps and the .md notes the
// public/ folder copies along. Everything else, every chunk and worker included, is counted, so the
// number is an upper bound. Writes dist/first-load.json and prints a summary line.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(DIST, p));
  }
})(DIST);

/** Why a file is not part of the first load, or null when it is. */
function onDemand(path) {
  if (path === 'first-load.json') return 'this report';
  if (path.endsWith('.map')) return 'source map';
  if (path.endsWith('.md')) return 'note';
  if (path.startsWith('input-profiles/')) return 'XR input profile';
  if (/^assets\/(HavokPhysics|physics-)/.test(path)) return 'physics (first stone)';
  // The emulator chunk: named after its package, or recognised by the device it emulates.
  if (/^assets\/.*\.js$/.test(path) && /iwer/i.test(path)) return 'emulator';
  if (/^assets\/.*\.js$/.test(path) && readFileSync(join(DIST, path), 'utf8').includes('Meta Quest 3')) return 'emulator';
  return null;
}

const rows = files.sort().map(path => {
  const buf = readFileSync(join(DIST, path));
  return { path, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length, lazy: onDemand(path) };
});
const sum = (list, k) => list.reduce((s, r) => s + r[k], 0);
const first = rows.filter(r => !r.lazy), lazy = rows.filter(r => r.lazy);
const mb = n => (n / 1e6).toFixed(2);
const out = {
  budgetBytes: 8e6,
  firstLoad: { bytes: sum(first, 'bytes'), gzip: sum(first, 'gzip'), files: first.map(({ path, bytes }) => ({ path, bytes })) },
  onDemand: { bytes: sum(lazy, 'bytes'), files: lazy.map(({ path, bytes, lazy: why }) => ({ path, bytes, why })) },
};
writeFileSync(join(DIST, 'first-load.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`first load: ${mb(out.firstLoad.bytes)} MB (${mb(out.firstLoad.gzip)} MB gzip) in ${first.length} files, budget 8 MB;`
  + ` on demand: ${mb(out.onDemand.bytes)} MB in ${lazy.length} files`);
for (const r of [...first].sort((a, b) => b.bytes - a.bytes).slice(0, 6)) console.log(`  ${mb(r.bytes).padStart(6)} MB  ${r.path}`);
// A warning, not a failure: the build itself is fine, and the number goes into the README either way.
if (out.firstLoad.bytes > out.budgetBytes) console.warn('WARNING: first load over the 8 MB budget');

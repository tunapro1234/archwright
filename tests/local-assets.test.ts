// Same origin only (src/net/local-assets.ts): the copied input profiles are complete and plain
// (no Draco, no KTX2, nothing referenced outside the file), model requests resolve to them, and the
// build-time rewrites still match the library sources they patch (vite.config.ts fails the build
// otherwise, which we would rather learn here).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FOREIGN_HOSTS, isForeign, LOCAL_PROFILES, modelFile, PROFILES_DIR, profileModel, sameOriginRewrites,
} from '../src/net/local-assets.js';

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'public', PROFILES_DIR);
const CDN = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';

function glbJson(path: string): Record<string, unknown> {
  const b = readFileSync(path);
  expect(b.subarray(0, 4).toString('latin1')).toBe('glTF');
  const len = b.readUInt32LE(12);
  expect(b.subarray(16, 20).toString('latin1')).toBe('JSON');
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}

describe('copied input profiles', () => {
  it.each(LOCAL_PROFILES.map(p => [p]))('%s: profile.json names a left and a right model, both here, plain glTF', profile => {
    const json = JSON.parse(readFileSync(join(DIR, profile, 'profile.json'), 'utf8'));
    expect(json.profileId).toBe(profile);
    for (const hand of ['left', 'right'] as const) {
      const file = modelFile(json, hand);
      expect(file).not.toBeNull();
      const gltf = glbJson(join(DIR, profile, file!));
      const ext = (gltf.extensionsUsed as string[] | undefined) ?? [];
      expect(ext.filter(e => /draco|basisu|ktx/i.test(e))).toEqual([]);
      const uris = [...((gltf.buffers as { uri?: string }[]) ?? []), ...((gltf.images as { uri?: string }[]) ?? [])].map(x => x.uri).filter(Boolean);
      expect(uris).toEqual([]); // everything embedded in the .glb
    }
  });

  it('nothing else is in the folder but the licence', () => {
    const extra = readdirSync(DIR).filter(f => !(LOCAL_PROFILES as readonly string[]).includes(f));
    expect(extra).toEqual(['LICENSE.md']);
    expect(readFileSync(join(DIR, 'LICENSE.md'), 'utf8')).toMatch(/^MIT License/);
  });
});

describe('profileModel', () => {
  it('reads the input layer\'s jsDelivr URL and the rewritten local one alike', () => {
    expect(profileModel(`${CDN}/meta-quest-touch-plus/left.glb`)).toEqual({ profile: 'meta-quest-touch-plus', hand: 'left' });
    expect(profileModel('/archwright/input-profiles/generic-hand/right.glb')).toEqual({ profile: 'generic-hand', hand: 'right' });
  });
  it('a profile we do not serve, or not a hand model, is not ours', () => {
    expect(profileModel(`${CDN}/valve-index/left.glb`)).toBeNull();
    expect(profileModel(`${CDN}/meta-quest-touch-plus/none.glb`)).toBeNull();
    expect(profileModel('https://example.com/model.glb')).toBeNull();
  });
});

describe('modelFile', () => {
  it('only a plain .glb file name from the layout', () => {
    expect(modelFile({ layouts: { left: { assetPath: 'left.glb' } } }, 'left')).toBe('left.glb');
    expect(modelFile({ layouts: { left: { assetPath: '../../x.glb' } } }, 'left')).toBeNull();
    expect(modelFile({ layouts: { left: { assetPath: 'https://x/left.glb' } } }, 'left')).toBeNull();
    expect(modelFile({ layouts: {} }, 'right')).toBeNull();
    expect(modelFile(null, 'right')).toBeNull();
  });
});

describe('isForeign', () => {
  const o = 'https://tunapro1234.github.io';
  it('same origin, relative, data: and blob: stay; any other origin leaves', () => {
    expect(isForeign(`${o}/archwright/x.glb`, o)).toBe(false);
    expect(isForeign('/archwright/x.glb', o)).toBe(false);
    expect(isForeign('data:model/gltf-binary;base64,AA', o)).toBe(false);
    expect(isForeign('blob:https://tunapro1234.github.io/1', o)).toBe(false);
    expect(isForeign('https://unpkg.com/three@0.181.0/x.js', o)).toBe(true);
    expect(isForeign(`${o}.evil.com/x`, o)).toBe(true);
  });
});

describe('build-time rewrites', () => {
  const rules = sameOriginRewrites('/archwright/');
  const files: Record<string, string> = {
    'input-profiles': 'node_modules/@iwsdk/xr-input/dist/gamepad/input-profiles.js',
    'gltf-loader': 'node_modules/@iwsdk/core/dist/asset/loaders/gltf-loader.js',
    avatar: 'node_modules/@pmndrs/uikit-horizon/dist/avatar/index.js',
  };
  it('each rule matches its library file, and its text is there to replace', () => {
    for (const path of Object.values(files)) {
      const full = join(ROOT, path);
      expect(existsSync(full), path).toBe(true);
      const hits = rules.filter(r => r.file.test(full));
      expect(hits.length, path).toBe(1);
      expect(readFileSync(full, 'utf8').includes(hits[0].from), path).toBe(true);
    }
  });
  it('what is left after a rewrite names no other host', () => {
    for (const r of rules) for (const h of FOREIGN_HOSTS) expect(r.to.includes(h)).toBe(false);
    expect(JSON.parse(rules[0].to)).toBe('/archwright/input-profiles');
  });
});

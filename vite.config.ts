// Based on the @iwsdk/create 1.0.1 template (MIT, Meta Platforms, Inc.).
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';
import { FOREIGN_HOSTS, sameOriginRewrites } from './src/net/local-assets';

const BASE = '/archwright/';

/**
 * Build only: rewrite the libraries' other-origin defaults to this site (src/net/local-assets.ts),
 * and fail the build if any host in FOREIGN_HOSTS is still named in the output.
 */
function sameOrigin(): Plugin {
  const rules = sameOriginRewrites(BASE);
  return {
    name: 'archwright-same-origin',
    apply: 'build',
    transform(code, id) {
      for (const r of rules) {
        if (!r.file.test(id)) continue;
        if (!code.includes(r.from)) this.error(`same-origin: ${r.from} not found in ${id} (library changed?)`);
        return { code: code.split(r.from).join(r.to), map: null };
      }
      return null;
    },
    generateBundle(_, bundle) {
      for (const [name, out] of Object.entries(bundle)) {
        const text = out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : '';
        for (const host of FOREIGN_HOSTS) if (text.includes(host)) this.error(`same-origin: ${name} still names ${host}`);
      }
    },
  };
}

export default defineConfig(({ isPreview }) => ({
  // `vite preview` serves the built dist/ over plain http, like GitHub Pages; the IWSDK
  // dev plugin (dev server, emulator, local https certificate) is only for dev and build.
  plugins: isPreview ? [] : [iwsdkDev(), sameOrigin()],
  // Local only: never bind a public interface.
  server: { host: '127.0.0.1', port: 8081, open: false },
  preview: { host: '127.0.0.1' },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  // Served from https://<user>.github.io/archwright/ on GitHub Pages.
  base: BASE,
}));

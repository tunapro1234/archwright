// Based on the @iwsdk/create 1.0.1 template (MIT, Meta Platforms, Inc.).
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

export default defineConfig(({ isPreview }) => ({
  // `vite preview` serves the built dist/ over plain http, like GitHub Pages; the IWSDK
  // dev plugin (dev server, emulator, local https certificate) is only for dev and build.
  plugins: isPreview ? [] : [iwsdkDev()],
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
  base: '/archwright/',
}));

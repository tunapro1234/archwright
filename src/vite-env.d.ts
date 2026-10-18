/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

/** The commit the build was made from (`git rev-parse --short HEAD`, 'dev' without git); vite.config.ts defines it. */
declare const __BUILD__: string;

import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so unit tests never load the IWSDK dev plugin.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});

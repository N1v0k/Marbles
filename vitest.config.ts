import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __SINGLEFILE__: 'false', __DEV_UI__: 'true' },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 30000,
  },
});

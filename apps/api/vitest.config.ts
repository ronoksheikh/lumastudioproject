import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test/setup.ts'],
    environment: 'node',
    testTimeout: 30_000,
    // the sandbox/isolation tests spawn real processes; keep them from fighting each other
    fileParallelism: false,
  },
});

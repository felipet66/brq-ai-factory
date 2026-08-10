import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 360_000,
    testTimeout: 360_000,
    include: ['core/sandbox-runner/integration/**/*.integration.ts'],
  },
});

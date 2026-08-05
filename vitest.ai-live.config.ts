import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['core/ai-provider/**/*.live.spec.ts'],
    testTimeout: 90_000,
  },
});

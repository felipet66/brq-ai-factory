import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['shared/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts', 'prisma/**/*.ts'],
      exclude: ['**/*.spec.ts', 'shared/types/**', 'generated/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    include: ['core/ai-provider/**/*.spec.ts', 'shared/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    exclude: ['core/ai-provider/**/*.live.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['core/ai-provider/**/*.ts', 'shared/**/*.ts', 'prisma/**/*.ts'],
      exclude: ['**/*.spec.ts', 'shared/types/**', 'generated/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});

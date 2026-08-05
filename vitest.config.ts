import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 60_000,
    include: [
      'core/agent-runner/**/*.spec.ts',
      'core/ai-provider/**/*.spec.ts',
      'core/artifact-generator/**/*.spec.ts',
      'core/knowledge-loader/**/*.spec.ts',
      'core/prompt-builder/**/*.spec.ts',
      'core/response-validator/**/*.spec.ts',
      'shared/**/*.spec.ts',
      'prisma/**/*.spec.ts',
    ],
    exclude: ['core/ai-provider/**/*.live.spec.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'core/agent-runner/**/*.ts',
        'core/ai-provider/**/*.ts',
        'core/artifact-generator/**/*.ts',
        'core/knowledge-loader/**/*.ts',
        'core/prompt-builder/**/*.ts',
        'core/response-validator/**/*.ts',
        'shared/**/*.ts',
        'prisma/**/*.ts',
      ],
      exclude: ['**/*.spec.ts', 'shared/types/**', 'generated/**'],
      reporter: ['text', 'json-summary'],
    },
  },
});

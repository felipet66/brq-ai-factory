import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    coverage: {
      provider: 'v8',
      include: [
        'src/app/api/**/*.ts',
        'src/app/page.tsx',
        'src/app/executions/**/*.tsx',
        'src/app/login/**/*.tsx',
        'src/app/profile/**/*.tsx',
        'src/api/**/*.ts',
        'src/components/auth/**/*.tsx',
        'src/components/execution/**/*.tsx',
        'src/components/history/**/*.tsx',
        'src/server/auth/**/*.ts',
        'src/server/runtime.ts',
      ],
      exclude: ['src/**/*.spec.ts', 'src/app/api/**/route.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});

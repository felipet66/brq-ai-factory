// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.includes('.spec.') ? [absolute] : [];
  });
}

describe('Execution History frontend boundary', () => {
  const historyRoot = path.resolve(process.cwd(), 'src/components/history');
  const historySource = productionFiles(historyRoot)
    .map((filename) => readFileSync(filename, 'utf8'))
    .join('\n');

  it('depends only on minimized HTTP client view models', () => {
    expect(historySource).not.toMatch(/from ['"]@brq\//);
    expect(historySource).not.toMatch(/from ['"]@\/server\//);
    expect(historySource).not.toMatch(/from ['"]@\/app\/api\//);
    expect(historySource).not.toMatch(/from ['"][^'"]*(?:core|agents)\//);
    expect(historySource).not.toMatch(/\bfetch\s*\(/);
    expect(historySource).not.toContain('dangerouslySetInnerHTML');
    expect(historySource).not.toMatch(/\b(?:prompt|rawResponse|specification|artifactContent)\b/);
  });

  it('keeps client boundaries restricted to interactive experiences', () => {
    const clientEntries = productionFiles(historyRoot)
      .filter((filename) => readFileSync(filename, 'utf8').startsWith("'use client';"))
      .map((filename) => path.basename(filename));

    expect(clientEntries).toEqual([
      'execution-history-detail-experience.tsx',
      'execution-history-experience.tsx',
    ]);
  });
});

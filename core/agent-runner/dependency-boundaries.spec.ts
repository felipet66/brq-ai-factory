import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_IMPORTS = [
  '@brq/ai-provider/openai',
  '@brq/knowledge-loader',
  '@brq/prisma',
  'openai',
  '/agents/',
  '/apps/',
  '/prisma/',
  '/orchestrator/',
  '/execution-engine/',
] as const;

async function productionSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'testing') {
        files.push(...(await productionSourceFiles(path)));
      }
      continue;
    }

    if (
      extname(entry.name) === '.ts' &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.live.spec.ts')
    ) {
      files.push(path);
    }
  }

  return files;
}

describe('Agent Runner dependency boundary', () => {
  it('depends only on public core contracts and shared infrastructure', async () => {
    const sourceFiles = await productionSourceFiles(MODULE_DIRECTORY);
    const violations: string[] = [];

    for (const sourceFile of sourceFiles) {
      const source = await readFile(sourceFile, 'utf8');

      for (const forbiddenImport of FORBIDDEN_IMPORTS) {
        if (source.includes(forbiddenImport)) {
          violations.push(`${sourceFile}: ${forbiddenImport}`);
        }
      }

      if (source.includes('PromptBuildInput')) {
        violations.push(`${sourceFile}: PromptBuildInput`);
      }
    }

    expect(violations).toEqual([]);
  });
});

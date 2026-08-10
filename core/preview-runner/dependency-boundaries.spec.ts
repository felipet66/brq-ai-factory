import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Preview Runner dependency boundary', () => {
  it('stays provider-neutral and does not know HTTP, Prisma, Docker or agents', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => `${root}/${name}`);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /@brq\/(?:factory-pipeline|execution-engine|execution-repository|sandbox-runner|orchestrator|ai-provider)|next\/|prisma|node:(?:fs|child_process|http|https|net)/iu,
      );
    }
  });
});

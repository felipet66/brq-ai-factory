import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Factory Pipeline dependency boundary', () => {
  it('coordinates only public ports and never imports adapters or infrastructure internals', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => `${root}/${name}`);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /@brq\/(?:ai-provider|agent-runner|execution-repository|execution-worker|job-queue|observability|orchestrator|prompt-builder|response-validator)/u,
      );
      expect(source, file).not.toMatch(
        /@brq\/(?:controlled-workspace\/filesystem|sandbox-runner\/docker)|node:(?:fs|child_process|net|http|https)/u,
      );
    }
  });

  it('declares only the approved public workspace dependencies', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('./package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string>; exports: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/code-generator-agent',
      '@brq/controlled-workspace',
      '@brq/execution-engine',
      '@brq/sandbox-runner',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({
      '.': './index.ts',
      './testing': './testing/index.ts',
    });
  });
});

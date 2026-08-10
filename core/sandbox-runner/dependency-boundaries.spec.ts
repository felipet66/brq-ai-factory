import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('sandbox runner provider-neutral boundary', () => {
  it('keeps the port independent from Docker, host execution and higher layers', async () => {
    const packageRoot = fileURLToPath(new URL('.', import.meta.url));
    const names = await readdir(packageRoot);
    const files = names
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => `${packageRoot}/${name}`)
      .sort();

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /(?:from|import\s*\()[\s(]*['"]\.\/docker|node:(?:child_process|fs|net|http|https)|\b(?:spawn|exec|fork)\s*\(/u,
      );
      expect(source, file).not.toMatch(
        /@brq\/(?:agent-runner|ai-provider|code-generator|execution-engine|execution-repository|orchestrator|prompt-builder)/u,
      );
    }
  });

  it('declares only the approved workspace dependencies and explicit adapters', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('./package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string>; exports: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/controlled-workspace',
      '@brq/shared',
      'zod',
    ]);
    expect(packageJson.exports).toEqual({
      '.': './index.ts',
      './docker': './docker/docker-sandbox-runner.ts',
      './testing': './testing/index.ts',
    });
  });
});

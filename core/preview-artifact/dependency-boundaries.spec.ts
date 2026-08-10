import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('PreviewArtifact dependency boundary', () => {
  it('does not depend on execution, agents, Docker, HTTP or persistence', async () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const files = (await readdir(root, { recursive: true }))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => `${root}/${name}`);
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(
        /@brq\/(?:factory-pipeline|execution-engine|execution-repository|sandbox-runner|orchestrator|ai-provider)|next\/|prisma|docker/iu,
      );
    }
  });
});

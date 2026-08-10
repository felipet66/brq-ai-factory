// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function profileFile(relativePath: string): Promise<string> {
  return readFile(path.resolve(process.cwd(), 'docker/factory-sandbox', relativePath), 'utf8');
}

describe('Docker Factory profile assets', () => {
  it('is separated from the Sprint 23 integration fixture and pins its runtime identity', async () => {
    const dockerfile = await profileFile('Dockerfile');

    expect(dockerfile).toContain('v24.19.0');
    expect(dockerfile).toContain('typescript-6.0.3.tgz');
    expect(dockerfile).toContain('org.brq.sandbox.factory-profile="node-typescript-24-v1"');
    expect(dockerfile).not.toContain('integration-fixture');
  });

  it('uses fixed helpers and never delegates execution to package scripts or a shell', async () => {
    const [prepare, test] = await Promise.all([
      profileFile('runner/prepare.mjs'),
      profileFile('runner/test.mjs'),
    ]);

    expect(prepare).not.toMatch(/npm\s+run|yarn|pnpm/u);
    expect(test).toContain("spawn(\n      '/usr/local/bin/node'");
    expect(test).toContain('shell: false');
    expect(test).not.toMatch(/npm\s+test|npm\s+run|yarn|pnpm/u);
  });
});

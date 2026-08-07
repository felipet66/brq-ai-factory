// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(absolute);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [absolute] : [];
  });
}

describe('HTTP adapter dependency boundary', () => {
  it('does not import agents, workflow internals or lower pipeline components', () => {
    const apiRoot = path.resolve(process.cwd(), 'src/app/api');
    const source = productionFiles(apiRoot)
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/@brq\/(product-owner-agent|developer-agent|qa-agent)/);
    expect(source).not.toMatch(/@brq\/prisma/);
    expect(source).not.toMatch(
      /@brq\/(orchestrator|ai-provider|knowledge-loader|prompt-builder|agent-runner|response-validator|artifact-generator)/,
    );
    expect(source).not.toMatch(/core\//);
    expect(source).not.toMatch(/agents\//);
  });
});

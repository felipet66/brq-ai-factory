import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'testing' ? [] : productionTypeScriptFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('response validator dependency boundaries', () => {
  it('does not import forbidden components in production', () => {
    const source = productionTypeScriptFiles(MODULE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /from ['"]@brq\/(?:ai-provider|prompt-builder|knowledge-loader|artifact-generator)/,
    );
    expect(source).not.toMatch(/from ['"].*(?:prisma|orchestrator|agents\/)/);
    expect(source).not.toContain('AIProvider');
    expect(source).not.toContain('PromptBuilder');
  });

  it('declares only the approved workspace and validation dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/agent-runner',
      '@brq/shared',
      'ajv',
      'ajv-formats',
      'zod',
    ]);
  });

  it('keeps the pipeline report and orchestrator internal', () => {
    const publicIndex = readFileSync(join(MODULE_ROOT, 'index.ts'), 'utf8');
    expect(publicIndex).not.toContain('ValidationReport');
    expect(publicIndex).not.toContain('executeValidationPipeline');
  });
});

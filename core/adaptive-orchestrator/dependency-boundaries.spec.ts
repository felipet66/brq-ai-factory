import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

function productionFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : productionFiles(path);
    return extname(path) === '.ts' && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('Adaptive Orchestrator dependency boundaries', () => {
  it('has no provider, agent, persistence, pipeline, sandbox, UI, or network dependency', () => {
    const source = productionFiles(MODULE_ROOT)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /@brq\/(?:ai-provider|agent-runner|product-owner-agent|developer-agent|qa-agent|code-generator-agent|execution-repository|execution-worker|factory-pipeline|sandbox-runner)/,
    );
    expect(source).not.toMatch(/\b(?:OpenAI|fetch|PrismaClient|Docker|child_process)\b/);
    expect(source).not.toMatch(/\b(?:retry|backoff|setTimeout|setInterval)\s*\(/i);
  });

  it('declares only zod and one public entrypoint', () => {
    const packageJson = JSON.parse(readFileSync(join(MODULE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      exports: Record<string, string>;
    };
    expect(packageJson.dependencies).toEqual({ zod: '^4.4.3' });
    expect(packageJson.exports).toEqual({ '.': './index.ts' });
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'testing') return productionFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [absolute]
      : [];
  });
}

describe('prompt inspector dependency boundary', () => {
  it('does not import concrete agents, providers, execution or persistence modules', () => {
    const source = productionFiles(path.resolve(process.cwd(), 'core/prompt-inspector'))
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/@brq\/(product-owner-agent|developer-agent|qa-agent)/);
    expect(source).not.toMatch(
      /@brq\/(ai-provider|artifact-generator|orchestrator|execution-engine|execution-repository|execution-worker|job-queue|observability)/,
    );
    expect(source).not.toContain('@brq/agent-runner');
    expect(source).not.toContain('OPENAI_API_KEY');
    expect(source).not.toContain('createAgentRunner');
  });

  it('declares only transport-neutral inspection dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'core/prompt-inspector/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@brq/knowledge-loader',
      '@brq/prompt-builder',
      '@brq/response-validator',
      '@brq/shared',
      'zod',
    ]);
  });
});

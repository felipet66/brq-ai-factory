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

describe('Prompt Playground server dependency boundary', () => {
  it('contains no provider, runner, execution, persistence or observability dependency', () => {
    const source = productionFiles(path.resolve(process.cwd(), 'src/server/playground'))
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');

    expect(source).not.toMatch(
      /@brq\/(ai-provider|agent-runner|artifact-generator|orchestrator|execution-engine|execution-repository|execution-worker|job-queue|observability|prisma)/,
    );
    expect(source).not.toContain('@brq/response-validator/development');
    expect(source).not.toContain('@/server/runtime');
    expect(source).not.toMatch(/\/testing(?:\/|')/);
    expect(source).not.toContain('OPENAI_API_KEY');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('createAgentRunner');
    expect(source).not.toContain('.execute(');
  });

  it('keeps concrete agents and lower prompt components out of the HTTP adapter', () => {
    const apiFiles = [
      path.resolve(process.cwd(), 'src/app/api/_lib/playground-handler.ts'),
      path.resolve(process.cwd(), 'src/app/api/_lib/playground-responses.ts'),
      ...productionFiles(path.resolve(process.cwd(), 'src/app/api/playground')),
    ];
    const source = apiFiles.map((filename) => readFileSync(filename, 'utf8')).join('\n');

    expect(source).not.toMatch(/@brq\/(product-owner-agent|developer-agent|qa-agent)/);
    expect(source).not.toMatch(
      /@brq\/(knowledge-loader|prompt-builder|response-validator|ai-provider|agent-runner)/,
    );
    expect(source).not.toContain("from './responses'");
    expect(source).not.toMatch(/\b(createProductOwnerAgent|createDeveloperAgent|createQAAgent)\b/);
  });
});

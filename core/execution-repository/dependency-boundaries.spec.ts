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

describe('execution repository dependency boundary', () => {
  it('does not import agents or lower AI pipeline components', () => {
    const source = productionFiles(path.resolve(process.cwd(), 'core/execution-repository'))
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/@brq\/(product-owner-agent|developer-agent|qa-agent|orchestrator)/);
    expect(source).not.toMatch(
      /@brq\/(ai-provider|knowledge-loader|prompt-builder|agent-runner|response-validator|artifact-generator)/,
    );
    expect(source).not.toContain('OPENAI_API_KEY');
  });

  it('keeps Prisma out of execution-engine and observability workspaces', () => {
    const source = [
      ...productionFiles(path.resolve(process.cwd(), 'core/execution-engine')),
      ...productionFiles(path.resolve(process.cwd(), 'core/observability')),
    ]
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(/@brq\/(execution-repository|prisma)/);
  });
});

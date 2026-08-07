import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSource(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'testing') return productionSource(absolute);
      return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? readFileSync(absolute, 'utf8')
        : '';
    })
    .join('\n');
}

describe('execution worker dependency boundary', () => {
  it('depends only on public queue, Engine, repository and Shared APIs', () => {
    const source = productionSource(path.resolve(process.cwd(), 'core/execution-worker'));
    expect(source).not.toMatch(/@brq\/(product-owner-agent|developer-agent|qa-agent|orchestrator)/);
    expect(source).not.toMatch(
      /@brq\/(ai-provider|knowledge-loader|prompt-builder|agent-runner|response-validator|artifact-generator|observability|prisma)/,
    );
    expect(source).not.toContain('OPENAI_API_KEY');
    expect(source).not.toMatch(/from ['"]@brq\/execution-(engine|repository)\//);
    expect(source).not.toMatch(/node:(worker_threads|cluster|child_process)/);
    expect(source).not.toMatch(/\b(retry|requeue|backoff)\b/i);
  });
});

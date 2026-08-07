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

describe('job queue dependency boundary', () => {
  it('depends only on public execution and shared contracts', () => {
    const source = productionFiles(path.resolve(process.cwd(), 'core/job-queue'))
      .map((filename) => readFileSync(filename, 'utf8'))
      .join('\n');
    expect(source).not.toMatch(
      /@brq\/(product-owner-agent|developer-agent|qa-agent|orchestrator|execution-repository|observability)/,
    );
    expect(source).not.toMatch(
      /@brq\/(ai-provider|knowledge-loader|prompt-builder|agent-runner|response-validator|artifact-generator)/,
    );
    expect(source).not.toMatch(
      /from ['"](?:redis|rabbitmq|kafka|bullmq|temporal|sqs|@google-cloud\/pubsub)/i,
    );
    expect(source).not.toContain('OPENAI_API_KEY');
  });

  it('has no retry, scheduling, external worker or threading surface', () => {
    const publicContracts = readFileSync(
      path.resolve(process.cwd(), 'core/job-queue/contracts.ts'),
      'utf8',
    );
    expect(publicContracts).not.toMatch(/\b(retry|requeue|backoff|schedule|cron)\b/i);
    expect(publicContracts).not.toMatch(/Worker|Thread|setInterval|setTimeout/);
  });
});

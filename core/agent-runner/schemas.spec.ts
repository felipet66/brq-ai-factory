import { describe, expect, it } from 'vitest';

import { createAgentRunner } from './agent-runner';
import { FakeAIProvider } from '@brq/ai-provider/fake';
import {
  agentRunRequestSchema,
  agentRunResultSchema,
  promptRequestSchema,
  runnerObservedMetricsSchema,
} from './schemas';
import { createAgentRunRequest, runnerDependencies } from './testing/agent-runner-fixtures';

describe('Agent Runner schemas', () => {
  it('validates the Runner-owned PromptRequest without exposing PromptBuildInput', () => {
    const request = createAgentRunRequest();

    expect(promptRequestSchema.safeParse(request.prompt).success).toBe(true);
    expect(agentRunRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects unknown fields, invalid limits and an agent mismatch', () => {
    const request = createAgentRunRequest();

    expect(agentRunRequestSchema.safeParse({ ...request, unknown: true }).success).toBe(false);
    expect(agentRunRequestSchema.safeParse({ ...request, timeoutMs: 999 }).success).toBe(false);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        context: {
          ...request.context,
          execution: { ...request.context.execution, agent: 'QA' },
        },
      }).success,
    ).toBe(false);
  });

  it('keeps observed phase durations coherent with the total duration', () => {
    expect(
      runnerObservedMetricsSchema.safeParse({
        totalDurationMs: 5,
        promptBuilderDurationMs: 6,
        providerDurationMs: 1,
        bytesSent: 1,
        bytesReceived: 1,
      }).success,
    ).toBe(false);
  });

  it('validates the complete result and its output-contract binding', async () => {
    const runner = createAgentRunner(runnerDependencies(new FakeAIProvider()));
    const result = await runner.run(createAgentRunRequest());

    expect(agentRunResultSchema.safeParse(result).success).toBe(true);
    expect(
      agentRunResultSchema.safeParse({
        ...result,
        outputContract: {
          id: 'contract:other',
          version: '1.0.0',
          format: 'TEXT',
          instructions: ['Outro contrato.'],
        },
      }).success,
    ).toBe(false);
  });
});

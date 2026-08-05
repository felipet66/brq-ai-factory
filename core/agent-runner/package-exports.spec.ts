import { AGENT_RUN_ERROR_CODES, agentRunRequestSchema, createAgentRunner } from '@brq/agent-runner';
import { FakeAIProvider } from '@brq/ai-provider/fake';
import { describe, expect, it } from 'vitest';

import { createAgentRunRequest, runnerDependencies } from './testing/agent-runner-fixtures';

describe('@brq/agent-runner package exports', () => {
  it('exposes the generic public API without a provider adapter subpath', async () => {
    const request = createAgentRunRequest();
    const runner = createAgentRunner(runnerDependencies(new FakeAIProvider()));

    expect(agentRunRequestSchema.safeParse(request).success).toBe(true);
    expect(AGENT_RUN_ERROR_CODES.CANCELLED).toBe('AGENT_RUN_CANCELLED');
    await expect(runner.run(request)).resolves.toMatchObject({
      provider: { provider: 'fake' },
    });
  });
});

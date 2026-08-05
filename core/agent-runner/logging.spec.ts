import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import type { AgentRunContext } from './contracts';
import { AGENT_RUN_ERROR_CODES, AgentRunError } from './errors';
import { correlationLogContext, logRunError } from './logging';

const CONTEXT: AgentRunContext = {
  execution: {
    executionId: 'execution-1',
    agentExecutionId: 'agent-execution-1',
    agent: 'DEVELOPER',
    attempt: 2,
    agentVersion: '1.0.0',
  },
  requestId: 'request-1',
  traceId: 'trace-1',
};

describe('Agent Runner logging', () => {
  it('uses only validated correlation fields', () => {
    expect(correlationLogContext(CONTEXT)).toEqual({
      executionId: 'execution-1',
      agentExecutionId: 'agent-execution-1',
      agent: 'DEVELOPER',
      attempt: 2,
      agentVersion: '1.0.0',
      requestId: 'request-1',
      traceId: 'trace-1',
    });
  });

  it('logs only canonical error metadata and never the raw cause', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const marker = 'PRIVATE_RAW_CAUSE_123';
    const error = new AgentRunError('Safe error.', {
      code: AGENT_RUN_ERROR_CODES.PROVIDER_FAILED,
      stage: 'PROVIDER_CALL',
      elapsedMs: 12,
      provider: 'fake',
      sourceCode: 'AI_PROVIDER_UNAVAILABLE',
      providerRetryable: true,
      cause: new Error(marker),
    });

    logRunError(logger, 'agent.run.failed', error, CONTEXT);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('AGENT_RUN_PROVIDER_FAILED');
    expect(lines[0]).not.toContain(marker);
    expect(lines[0]).not.toContain('cause');
    expect(lines[0]).not.toContain('stack');
  });
});

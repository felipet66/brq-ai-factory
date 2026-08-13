// @vitest-environment node

import { FakeAIProvider } from '@brq/ai-provider/fake';
import { ExecutionEngineError, executionRequestSchema } from '@brq/execution-engine';
import { createInMemoryExecutionRecordRepository } from '@brq/execution-repository';
import { FakeKnowledgeSource } from '@brq/knowledge-loader/testing';
import { createInMemoryExecutionHistory } from '@brq/observability';
import { createLogger } from '@brq/shared/logger/logger';
import { GREENFIELD_DELIVERY_INTENT } from '@brq/shared/constants/delivery-intent';
import { describe, expect, it } from 'vitest';

import { executionBody, FIXED_REQUEST_ID } from '../test/api-fixtures';
import { createApplicationRuntime } from './runtime';

describe('application execution repository integration', () => {
  it('persists a cancelled lifecycle through the host without calling a provider', async () => {
    const provider = new FakeAIProvider();
    const repository = createInMemoryExecutionRecordRepository();
    let time = Date.parse('2026-08-07T12:00:00.000Z');
    const now = () => ++time;
    const engine = await createApplicationRuntime({
      aiProvider: provider,
      knowledgeSource: new FakeKnowledgeSource(),
      executionHistory: createInMemoryExecutionHistory({ now }),
      executionRepository: repository,
      logger: createLogger({ sink: () => undefined }),
      now,
    });
    const request = executionRequestSchema.parse({
      ...executionBody(),
      requestId: FIXED_REQUEST_ID,
      deliveryIntent: GREENFIELD_DELIVERY_INTENT,
    });
    const controller = new AbortController();
    controller.abort();

    const caught = await engine
      .execute(request, { signal: controller.signal })
      .catch((error) => error);

    expect(caught).toBeInstanceOf(ExecutionEngineError);
    const result = (caught as ExecutionEngineError).result!;
    const persisted = await repository.findByExecutionId(result.executionId);
    expect(provider.calls).toHaveLength(0);
    expect(persisted).toMatchObject({
      executionId: result.executionId,
      workflowId: request.workflowId,
      projectName: request.demand.title,
      status: 'CANCELLED',
      hashes: result.hashes,
    });
    expect(persisted?.lifecycle.map((event) => event.state)).toEqual(['CREATED', 'CANCELLED']);
    expect(persisted?.observation?.summary?.workflowStatus).toBe('CANCELLED');
  });
});

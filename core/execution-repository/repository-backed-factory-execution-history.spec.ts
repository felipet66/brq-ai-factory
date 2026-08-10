import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { createInMemoryFactoryExecutionHistory } from '@brq/observability';
import { describe, expect, it } from 'vitest';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import { createRepositoryBackedFactoryExecutionHistory } from './repository-backed-factory-execution-history';
import { createExecutionRequestFixture } from './testing/execution-record-fixtures';

describe('Repository-backed Factory execution history', () => {
  it('persiste revisões v2 sem terminalizar o aggregate antes da Factory', async () => {
    const request = createExecutionRequestFixture();
    const result = createFactoryExecutionResultFixture({
      executionId: `execution-${'d'.repeat(32)}`,
      workflowId: request.workflowId,
    });
    const repository = createInMemoryExecutionRecordRepository();
    await repository.create({
      workflowId: request.workflowId,
      requestId: request.requestId ?? null,
      traceId: request.traceId ?? null,
      projectName: request.demand.title,
      createdAt: result.startedAt,
      metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    });
    await repository.markRunning({ workflowId: request.workflowId, startedAt: result.startedAt });
    const history = createRepositoryBackedFactoryExecutionHistory({
      history: createInMemoryFactoryExecutionHistory({
        now: () => Date.parse(result.finishedAt),
      }),
      repository,
    });

    history.beginFactory(request);
    history.capture('info', 'factory.pipeline.started', {
      workflowId: request.workflowId,
      executionId: result.executionId,
    });
    await history.flush(request.workflowId);
    expect(await repository.findByWorkflowId(request.workflowId)).toMatchObject({
      status: 'RUNNING',
      observation: { observabilityVersion: '2.0.0', status: 'RUNNING' },
    });

    history.completeFactory(result);
    await history.flush(request.workflowId);
    expect(await repository.findByWorkflowId(request.workflowId)).toMatchObject({
      status: 'RUNNING',
      observation: {
        observabilityVersion: '2.0.0',
        status: 'SUCCESS',
        summary: { factoryResultHash: result.hashes.factoryResultHash },
      },
    });
  });
});

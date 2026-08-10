import {
  FACTORY_PIPELINE_ERROR_CODES,
  FactoryPipelineError,
  type FactoryPipelineCoordinator,
} from '@brq/factory-pipeline';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { describe, expect, it, vi } from 'vitest';

import { createInMemoryExecutionRecordRepository } from './adapters/in-memory-execution-record-repository';
import type { PersistentFactoryExecutionHistory } from './contracts';
import { EXECUTION_REPOSITORY_ERROR_CODES } from './errors';
import { createPersistentFactoryPipeline } from './persistent-factory-pipeline';
import { createExecutionRequestFixture } from './testing/execution-record-fixtures';

function history(): PersistentFactoryExecutionHistory {
  return {
    beginFactory: vi.fn(),
    capture: vi.fn(),
    completeFactory: vi.fn(),
    get: vi.fn(() => null),
    flush: vi.fn(async () => undefined),
  };
}

describe('Persistent Factory Pipeline', () => {
  it('persiste uma única transição terminal da Factory e preserva o resultado', async () => {
    const request = createExecutionRequestFixture();
    const result = createFactoryExecutionResultFixture({
      executionId: `execution-${'b'.repeat(32)}`,
      workflowId: request.workflowId,
    });
    const pipeline: FactoryPipelineCoordinator = { execute: vi.fn(async () => result) };
    const repository = createInMemoryExecutionRecordRepository();
    const persistentHistory = history();
    const persistent = createPersistentFactoryPipeline({
      pipeline,
      repository,
      history: persistentHistory,
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).resolves.toBe(result);
    const record = await repository.findByExecutionId(result.executionId);
    expect(record).toMatchObject({
      status: 'SUCCESS',
      workflowStatus: 'SUCCESS',
      factoryResult: { hashes: { factoryResultHash: result.hashes.factoryResultHash } },
    });
    expect(record?.lifecycle.map((event) => event.state)).toEqual([
      'CREATED',
      'RUNNING',
      'SUCCESS',
    ]);
    expect(persistentHistory.flush).toHaveBeenCalledWith(request.workflowId);
    expect(pipeline.execute).toHaveBeenCalledOnce();
  });

  it('persiste resultado terminal anexado e relança o mesmo erro técnico', async () => {
    const request = createExecutionRequestFixture();
    const result = createFactoryExecutionResultFixture({
      executionId: `execution-${'c'.repeat(32)}`,
      workflowId: request.workflowId,
    });
    const failure = new FactoryPipelineError('terminal wrapper', {
      code: FACTORY_PIPELINE_ERROR_CODES.INTERNAL_ERROR,
      stage: 'WORKSPACE_RELEASE',
      result,
    });
    const repository = createInMemoryExecutionRecordRepository();
    const persistent = createPersistentFactoryPipeline({
      pipeline: { execute: async () => Promise.reject(failure) },
      repository,
      history: history(),
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).rejects.toBe(failure);
    await expect(repository.findByExecutionId(result.executionId)).resolves.toMatchObject({
      status: 'SUCCESS',
      factoryResult: { hashes: { factoryResultHash: result.hashes.factoryResultHash } },
    });
  });

  it('rejeita composição sem as capabilities públicas obrigatórias', () => {
    expect(() =>
      createPersistentFactoryPipeline({
        pipeline: {} as FactoryPipelineCoordinator,
        repository: createInMemoryExecutionRecordRepository(),
        history: history(),
      }),
    ).toThrowError(
      expect.objectContaining({ code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION }),
    );
  });
});

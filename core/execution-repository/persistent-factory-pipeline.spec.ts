import {
  FACTORY_PIPELINE_ERROR_CODES,
  FactoryPipelineError,
  calculateFactoryPipelineResultHash,
  factoryExecutionResultSchema,
  type FactoryExecutionResult,
  type FactoryPipelineCoordinator,
} from '@brq/factory-pipeline';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { createLogger } from '@brq/shared/logger/logger';
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

function failedDeveloperResult(
  request: ReturnType<typeof createExecutionRequestFixture>,
): FactoryExecutionResult {
  const successful = createFactoryExecutionResultFixture({
    executionId: `execution-${'c'.repeat(32)}`,
    workflowId: request.workflowId,
  });
  const failure = {
    code: FACTORY_PIPELINE_ERROR_CODES.EXECUTION_FAILED,
    stage: 'DEVELOPER' as const,
    sourceCode: 'ORCHESTRATOR_DEVELOPER_FAILED',
    reasonCode: null,
    message: 'A execução funcional não foi concluída.',
  };
  const stages = successful.stages.map((stage, index) =>
    index < 1
      ? stage
      : index === 1
        ? { ...stage, status: 'FAILED' as const, outputHash: null, failure }
        : {
            ...stage,
            status: 'SKIPPED' as const,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            outputHash: null,
            failure: null,
          },
  );
  const { factoryResultHash: _factoryResultHash, ...hashesWithoutResult } = successful.hashes;
  void _factoryResultHash;
  const candidate = {
    ...successful,
    status: 'FAILED' as const,
    terminalStage: 'DEVELOPER' as const,
    stages,
    execution: { ...successful.execution, status: 'FAILED' as const },
    agents: {
      ...successful.agents,
      developer: {
        ...successful.agents.developer,
        status: 'FAILED' as const,
        outcome: 'VALIDATION_REJECTED' as const,
        outputHash: null,
      },
      qa: {
        ...successful.agents.qa,
        status: 'SKIPPED' as const,
        outcome: null,
        readiness: null,
        agentVersion: null,
        outputHash: null,
      },
    },
    hashes: hashesWithoutResult,
    failure,
  };
  return factoryExecutionResultSchema.parse({
    ...candidate,
    hashes: {
      ...hashesWithoutResult,
      factoryResultHash: calculateFactoryPipelineResultHash(candidate),
    },
  });
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
    const result = failedDeveloperResult(request);
    const failure = new FactoryPipelineError('terminal wrapper', {
      code: FACTORY_PIPELINE_ERROR_CODES.INTERNAL_ERROR,
      stage: 'DEVELOPER',
      result,
    });
    const repository = createInMemoryExecutionRecordRepository();
    const persistentHistory = history();
    vi.mocked(persistentHistory.get).mockImplementation(() => {
      throw Object.assign(new Error('private snapshot details'), {
        code: 'OBSERVABILITY_INVALID_SNAPSHOT',
      });
    });
    const persistent = createPersistentFactoryPipeline({
      pipeline: { execute: async () => Promise.reject(failure) },
      repository,
      history: persistentHistory,
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).rejects.toBe(failure);
    await expect(repository.findByExecutionId(result.executionId)).resolves.toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.code, sourceCode: result.failure?.sourceCode },
      factoryResult: { hashes: { factoryResultHash: result.hashes.factoryResultHash } },
    });
  });

  it('terminaliza com snapshot nulo quando flush observacional falha e sanitiza o log', async () => {
    const request = createExecutionRequestFixture();
    const result = failedDeveloperResult(request);
    const baseRepository = createInMemoryExecutionRecordRepository();
    const completeFactory = vi.fn(baseRepository.completeFactory);
    const repository = { ...baseRepository, completeFactory };
    const persistentHistory = history();
    vi.mocked(persistentHistory.flush).mockRejectedValue(
      Object.assign(new Error('TOP-SECRET-OBSERVABILITY-DETAIL'), {
        code: 'OBSERVABILITY_INVALID_SNAPSHOT',
      }),
    );
    const lines: string[] = [];
    const persistent = createPersistentFactoryPipeline({
      pipeline: { execute: async () => result },
      repository,
      history: persistentHistory,
      logger: createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) }),
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).resolves.toBe(result);
    expect(completeFactory).toHaveBeenCalledWith(request.workflowId, result, null);
    await expect(repository.findByExecutionId(result.executionId)).resolves.toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.code },
      observation: null,
    });
    expect(lines.join('\n')).toContain('execution.repository.factory_observation.terminal.failed');
    expect(lines.join('\n')).toContain('OBSERVABILITY_INVALID_SNAPSHOT');
    expect(lines.join('\n')).toContain('DEVELOPER');
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
  });

  it('rejeita snapshot observacional malformado sem impedir a terminalização funcional', async () => {
    const request = createExecutionRequestFixture();
    const result = failedDeveloperResult(request);
    const baseRepository = createInMemoryExecutionRecordRepository();
    const completeFactory = vi.fn(baseRepository.completeFactory);
    const persistentHistory = history();
    vi.mocked(persistentHistory.get).mockReturnValue({ invalid: true } as never);
    const persistent = createPersistentFactoryPipeline({
      pipeline: { execute: async () => result },
      repository: { ...baseRepository, completeFactory },
      history: persistentHistory,
      logger: createLogger({ sink: () => undefined }),
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).resolves.toBe(result);
    expect(completeFactory).toHaveBeenCalledWith(request.workflowId, result, null);
    await expect(baseRepository.findByExecutionId(result.executionId)).resolves.toMatchObject({
      status: 'FAILED',
      observation: null,
    });
  });

  it('mantém o resultado terminal quando o sink de logging falha', async () => {
    const request = createExecutionRequestFixture();
    const result = failedDeveloperResult(request);
    const repository = createInMemoryExecutionRecordRepository();
    const persistent = createPersistentFactoryPipeline({
      pipeline: { execute: async () => result },
      repository,
      history: history(),
      logger: createLogger({
        sink: () => {
          throw new Error('private logging sink failure');
        },
      }),
      now: () => Date.parse(result.startedAt),
    });

    await expect(persistent.execute(request)).resolves.toBe(result);
    await expect(repository.findByExecutionId(result.executionId)).resolves.toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.code },
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

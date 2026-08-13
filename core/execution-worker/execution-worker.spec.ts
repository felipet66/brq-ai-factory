import {
  createExecutionEngine,
  deriveExecutionIdentity,
  executionResultSchema,
  type ExecutionEngine,
  type ExecutionOptions,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import {
  createInMemoryExecutionRecordRepository,
  createPersistentFactoryPipeline,
  createPersistentExecutionEngine,
  type ExecutionRecordRepository,
  type PersistentFactoryExecutionHistory,
  type PersistentExecutionHistory,
} from '@brq/execution-repository';
import {
  FactoryPipelineError,
  createFactoryPipelineCoordinator,
  type FactoryExecutionResult,
  type FactoryPipelineRunOptions,
} from '@brq/factory-pipeline';
import { createInMemoryJobQueue, type JobQueue } from '@brq/job-queue';
import {
  createFactoryExecutionResultFixture,
  createFactoryPipelineConfigurationFixture,
  createFactoryTechnicalCheckpointFixture,
} from '@brq/factory-pipeline/testing';
import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import {
  createDeveloperRejectedWorkflowResultFixture,
  createWorkflowRequestForExecution,
} from '../execution-engine/testing/execution-engine-fixtures';
import type { ExecutionWorker } from './contracts';
import { createExecutionDispatcher } from './execution-dispatcher';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';
import { createExecutionWorker } from './execution-worker';
import {
  EXECUTION_WORKER_FIXTURE_EPOCH,
  createCancellationError,
  createCancelledExecutionResultFixture,
  createFailedExecutionResultFixture,
  createSuccessfulExecutionResultFixture,
  createWorkerExecutionRequestFixture,
  incrementalWorkerClock,
} from './testing/execution-worker-fixtures';

function history(): PersistentExecutionHistory {
  return {
    begin() {},
    capture() {},
    complete() {},
    get: () => null,
    flush: vi.fn(async () => undefined),
  };
}

function factoryHistory(): PersistentFactoryExecutionHistory {
  return {
    beginFactory() {},
    capture() {},
    completeFactory() {},
    get: () => null,
    flush: vi.fn(async () => undefined),
  };
}

function persistentEngine(
  engine: ExecutionEngine,
  repository: ExecutionRecordRepository,
): ExecutionEngine {
  return createPersistentExecutionEngine({
    engine,
    repository,
    history: history(),
    logger: createLogger({ sink: () => undefined }),
    now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
  });
}

async function dispatch(
  queue: JobQueue,
  repository: ExecutionRecordRepository,
  request: ExecutionRequest,
) {
  return createExecutionDispatcher({
    queue,
    repository,
    now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
  }).dispatch(request);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('execution worker', () => {
  it('propagates a private REQUIRE_HIT dispatch mode to the executor', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () =>
      createFactoryExecutionResultFixture({
        executionId: deriveExecutionIdentity(request).executionId,
        workflowId: request.workflowId,
      }),
    );
    const worker = createExecutionWorker({ queue, repository, pipeline: { execute } });
    const dispatcher = createExecutionDispatcher({
      queue,
      repository,
      now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
    });

    await dispatcher.dispatchWithOptions(request, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: `execution-${'f'.repeat(32)}`,
    });
    await worker.drain();

    expect(execute).toHaveBeenCalledWith(request, {
      signal: expect.any(AbortSignal),
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: `execution-${'f'.repeat(32)}`,
    });
  });

  it('surfaces a strict cache miss on the terminal job without retrying', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const failed = createFailedExecutionResultFixture(request);
    const cacheMiss = executionResultSchema.parse({
      ...failed,
      failure: {
        ...failed.failure,
        sourceCode: 'AI_PROVIDER_CACHE_MISS',
      },
    });
    const execute = vi.fn(async () => cacheMiss);
    const worker = createExecutionWorker({ queue, repository, engine: { execute } });
    const dispatcher = createExecutionDispatcher({
      queue,
      repository,
      now: () => EXECUTION_WORKER_FIXTURE_EPOCH,
    });
    const job = await dispatcher.dispatchWithOptions(request, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: `execution-${'f'.repeat(32)}`,
    });

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    await expect(queue.get(job.jobId)).resolves.toMatchObject({
      status: 'FAILED',
      failure: { code: 'AI_PROVIDER_CACHE_MISS' },
    });
  });

  it('settles a job only after the full Factory Pipeline returns its terminal result', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () =>
      createFactoryExecutionResultFixture({
        executionId: deriveExecutionIdentity(request).executionId,
        workflowId: request.workflowId,
      }),
    );
    const worker = createExecutionWorker({ queue, repository, pipeline: { execute } });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'SUCCESS' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      job: { status: 'SUCCESS' },
    });
  });

  it('terminalizes both ExecutionRecord and Job when Factory observability fails', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const workflowRequest = createWorkflowRequestForExecution(request, identity.executionId);
    const developerRejectedWorkflow =
      await createDeveloperRejectedWorkflowResultFixture(workflowRequest);
    const executionEngine = createExecutionEngine({
      orchestrator: { execute: async () => developerRejectedWorkflow },
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const codeGeneratorExecute = vi.fn(async () => {
      throw new Error('Code Generator must be skipped.');
    });
    const workspacePlan = vi.fn(() => {
      throw new Error('Workspace plan must be skipped.');
    });
    const workspaceMaterialize = vi.fn(async () => {
      throw new Error('Workspace materialization must be skipped.');
    });
    const workspaceRelease = vi.fn(async () => {
      throw new Error('Workspace release must be skipped.');
    });
    const sandboxRun = vi.fn(async () => {
      throw new Error('Sandbox must be skipped.');
    });
    const factory = createFactoryPipelineCoordinator({
      executionEngine,
      codeGeneratorAgent: { execute: codeGeneratorExecute },
      workspace: {
        plan: workspacePlan,
        materialize: workspaceMaterialize,
        release: workspaceRelease,
      },
      sandboxRunner: { run: sandboxRun },
      configuration: createFactoryPipelineConfigurationFixture(),
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const factoryCompleted = deferred<FactoryExecutionResult>();
    const observation = factoryHistory();
    vi.mocked(observation.flush).mockRejectedValue(
      Object.assign(new Error('PRIVATE-OBSERVABILITY-DETAIL'), {
        code: 'OBSERVABILITY_INVALID_SNAPSHOT',
      }),
    );
    const pipeline = createPersistentFactoryPipeline({
      pipeline: {
        execute: async (executionRequest, runOptions) => {
          const result = await factory.execute(executionRequest, runOptions);
          factoryCompleted.resolve(result);
          return result;
        },
      },
      repository,
      history: observation,
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const worker = createExecutionWorker({ queue, repository, pipeline, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();
    const result = await factoryCompleted.promise;

    expect(result).toMatchObject({
      status: 'FAILED',
      terminalStage: 'DEVELOPER',
      failure: { stage: 'DEVELOPER', sourceCode: 'RESPONSE_VALIDATION' },
      generation: { status: 'SKIPPED' },
      workspace: {
        planStatus: 'SKIPPED',
        materializationStatus: 'SKIPPED',
        releaseStatus: 'NOT_REQUIRED',
      },
      sandbox: { status: 'SKIPPED' },
    });
    expect(result.stages.map(({ stageId, status }) => [stageId, status])).toEqual([
      ['PRODUCT_OWNER', 'SUCCESS'],
      ['DEVELOPER', 'FAILED'],
      ['QA', 'SKIPPED'],
      ['CODE_GENERATOR', 'SKIPPED'],
      ['CODE_PROFILE_VALIDATION', 'SKIPPED'],
      ['WORKSPACE_PLAN', 'SKIPPED'],
      ['WORKSPACE_MATERIALIZATION', 'SKIPPED'],
      ['SANDBOX_PREPARE', 'SKIPPED'],
      ['SANDBOX_TYPECHECK', 'SKIPPED'],
      ['SANDBOX_BUILD', 'SKIPPED'],
      ['SANDBOX_TEST', 'SKIPPED'],
      ['WORKSPACE_RELEASE', 'SKIPPED'],
    ]);
    expect(codeGeneratorExecute).not.toHaveBeenCalled();
    expect(workspacePlan).not.toHaveBeenCalled();
    expect(workspaceMaterialize).not.toHaveBeenCalled();
    expect(workspaceRelease).not.toHaveBeenCalled();
    expect(sandboxRun).not.toHaveBeenCalled();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.sourceCode ?? result.failure?.code },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: { code: result.failure?.code, sourceCode: result.failure?.sourceCode },
      factoryResult: {
        status: 'FAILED',
        terminalStage: 'DEVELOPER',
        hashes: { factoryResultHash: result.hashes.factoryResultHash },
      },
      observation: null,
    });
    expect(lines.join('\n')).toContain('execution.repository.factory_observation.terminal.failed');
    expect(lines.join('\n')).toContain(job.jobId);
    expect(lines.join('\n')).toContain('OBSERVABILITY_INVALID_SNAPSHOT');
    expect(lines.join('\n')).not.toContain('PRIVATE-OBSERVABILITY-DETAIL');
  });

  it('terminalizes execution and job when durable technical checkpoint persistence fails', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const repository = {
      ...baseRepository,
      saveTechnicalCheckpoint: vi.fn(async () =>
        Promise.reject(new Error('TOP-SECRET-CHECKPOINT-PERSISTENCE')),
      ),
    };
    const request = createWorkerExecutionRequestFixture();
    const checkpoint = createFactoryTechnicalCheckpointFixture();
    const execute = vi.fn(
      async (_request: ExecutionRequest, runOptions?: FactoryPipelineRunOptions) => {
        try {
          await runOptions?.onTechnicalCheckpoint?.(checkpoint);
        } catch (cause) {
          throw new FactoryPipelineError('Private checkpoint persistence details.', {
            code: 'FACTORY_PIPELINE_TECHNICAL_CHECKPOINT_FAILED',
            stage: 'TECHNICAL_CHECKPOINT',
            reasonCode: 'TECHNICAL_CHECKPOINT_PERSISTENCE_FAILED',
            cause,
          });
        }
        throw new Error('The checkpoint callback must fail.');
      },
    );
    const pipeline = createPersistentFactoryPipeline({
      pipeline: {
        execute,
        resumeTechnical: vi.fn(async () => Promise.reject(new Error('not used'))),
      },
      repository,
      history: factoryHistory(),
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const worker = createExecutionWorker({ queue, repository, pipeline, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(repository.saveTechnicalCheckpoint).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: 'FACTORY_PIPELINE_TECHNICAL_CHECKPOINT_FAILED' },
    });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: {
        kind: 'INFRASTRUCTURE',
        code: 'FACTORY_PIPELINE_TECHNICAL_CHECKPOINT_FAILED',
        sourceCode: null,
      },
      factoryResult: null,
    });
    expect(
      (await baseRepository.findByJobId(job.jobId))?.lifecycle.map((event) => event.state),
    ).toEqual(['CREATED', 'RUNNING', 'FAILED']);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
    expect(lines.join('\n')).not.toContain('Private checkpoint persistence details.');
  });

  it('terminalizes execution and job when completeFactory fails before returning the result', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const completeFactory = vi.fn(async () =>
      Promise.reject(new Error('TOP-SECRET-COMPLETE-FACTORY')),
    );
    const repository = { ...baseRepository, completeFactory };
    const request = createWorkerExecutionRequestFixture();
    const identity = deriveExecutionIdentity(request);
    const result = createFactoryExecutionResultFixture({
      executionId: identity.executionId,
      workflowId: request.workflowId,
    });
    const pipeline = createPersistentFactoryPipeline({
      pipeline: { execute: async () => result },
      repository,
      history: factoryHistory(),
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const worker = createExecutionWorker({ queue, repository, pipeline });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(completeFactory).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED },
    });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: {
        kind: 'INFRASTRUCTURE',
        code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
      },
      factoryResult: null,
    });
  });

  it('consumes jobs in FIFO order and invokes the public Engine exactly once per job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const firstRequest = createWorkerExecutionRequestFixture(1);
    const secondRequest = createWorkerExecutionRequestFixture(2);
    const [firstResult, secondResult] = await Promise.all([
      createSuccessfulExecutionResultFixture(firstRequest),
      createSuccessfulExecutionResultFixture(secondRequest),
    ]);
    const results = new Map([
      [firstRequest.workflowId, firstResult],
      [secondRequest.workflowId, secondResult],
    ]);
    const order: string[] = [];
    const execute = vi.fn(async (request: ExecutionRequest) => {
      order.push(request.workflowId);
      return results.get(request.workflowId)!;
    });
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const firstJob = await dispatch(queue, repository, firstRequest);
    const secondJob = await dispatch(queue, repository, secondRequest);

    await worker.drain();
    await worker.drain();

    expect(order).toEqual([firstRequest.workflowId, secondRequest.workflowId]);
    expect(execute).toHaveBeenCalledTimes(2);
    const firstTerminal = await queue.get(firstJob.jobId);
    expect(firstTerminal).toMatchObject({ status: 'SUCCESS', attempt: 1 });
    expect(await queue.get(secondJob.jobId)).toMatchObject({ status: 'SUCCESS', attempt: 1 });
    const firstPersisted = await repository.findByJobId(firstJob.jobId);
    expect(firstPersisted).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(firstPersisted?.job?.finishedAt).toBe(firstTerminal?.finishedAt);
    expect(firstPersisted?.job?.finishedAt).not.toBe(firstResult.finishedAt);
    expect(await repository.findByJobId(secondJob.jobId)).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(Object.keys(worker)).not.toContain('retry');
    expect(Object.keys(worker)).not.toContain('requeue');
  });

  it('maps a resolved functional execution failure to a terminal failed job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createFailedExecutionResultFixture(request);
    const execute = vi.fn(async () => result);
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: result.failure?.code },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('does not retry when the final job timestamp cannot be refined in persistence', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobTerminal: vi.fn(async () => Promise.reject(new Error('terminal storage secret'))),
    };
    const request = createWorkerExecutionRequestFixture();
    const result = await createSuccessfulExecutionResultFixture(request);
    const execute = vi.fn(async () => result);
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
      logger,
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();
    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'SUCCESS' });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'SUCCESS',
      job: { status: 'SUCCESS' },
    });
    expect(lines.join('\n')).toContain('execution.worker.terminal.persistence.failed');
    expect(lines.join('\n')).not.toContain('terminal storage secret');
  });

  it('maps an ExecutionEngineError with a terminal result to a cancelled job', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const engineError = createCancellationError(result);
    const execute = vi.fn(async () => Promise.reject(engineError));
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      failure: { code: 'JOB_QUEUE_CANCELLED' },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails closed before calling the Engine when RUNNING persistence fails', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const job = await dispatch(queue, baseRepository, request);
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobRunning: vi.fn(async () => Promise.reject(new Error('database secret'))),
      failInfrastructure: vi.fn(async (input) => baseRepository.failInfrastructure(input)),
    };
    const execute = vi.fn(async () => createFailedExecutionResultFixture(request));
    const worker = createExecutionWorker({ queue, repository, engine: { execute } });

    await worker.drain();

    expect(execute).not.toHaveBeenCalled();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED },
    });
    expect(await baseRepository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: { kind: 'INFRASTRUCTURE', code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED },
    });
    expect(repository.failInfrastructure).toHaveBeenCalledOnce();
  });

  it('sanitizes a technical Engine failure and never retries it', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture(1, {
      demand: {
        title: 'Private title',
        description: 'TOP-SECRET-WORKER-PAYLOAD',
        businessGoal: 'Never log me.',
      },
    });
    const rawFailure = new Error('TOP-SECRET-ENGINE-CAUSE');
    const execute = vi.fn(async () => Promise.reject(rawFailure));
    const worker = createExecutionWorker({ queue, repository, engine: { execute }, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();
    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: {
        code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
        message: 'Falha técnica da execução.',
      },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: {
        kind: 'INFRASTRUCTURE',
        code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED,
      },
    });
    expect(lines.join('\n')).toContain('execution.worker.failed');
    expect(lines.join('\n')).toContain(EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
    expect(lines.join('\n')).not.toContain('Private title');
  });

  it('logs a sanitized secondary persistence failure instead of swallowing it', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      failInfrastructure: vi.fn(async () =>
        Promise.reject(new Error('TOP-SECRET-SECONDARY-PERSISTENCE')),
      ),
    };
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () => Promise.reject(new Error('TOP-SECRET-PRIMARY-FAILURE')));
    const worker = createExecutionWorker({ queue, repository, engine: { execute }, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(await queue.get(job.jobId)).toMatchObject({ status: 'FAILED' });
    expect(repository.failInfrastructure).toHaveBeenCalledOnce();
    expect(lines.join('\n')).toContain('execution.worker.infrastructure.persistence.failed');
    expect(lines.join('\n')).toContain(EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
  });

  it('preserves a safe Factory preflight source code without exposing its private cause', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      logger,
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () =>
      Promise.reject(
        new FactoryPipelineError('PRIVATE DOCKER DETAILS', {
          code: 'FACTORY_PIPELINE_SANDBOX_FAILED',
          stage: 'SANDBOX_PREPARE',
          sourceCode: 'DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH',
        }),
      ),
    );
    const worker = createExecutionWorker({ queue, repository, pipeline: { execute }, logger });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: 'DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH' },
    });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'FAILED',
      job: { status: 'FAILED' },
      failure: { kind: 'INFRASTRUCTURE', code: 'DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH' },
    });
    expect(lines.join('\n')).toContain('DOCKER_IMAGE_REQUIRED_LABEL_MISMATCH');
    expect(lines.join('\n')).not.toContain('PRIVATE DOCKER DETAILS');
  });

  it('cancels a queued job without calling the Engine and persists cancellation', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () => createFailedExecutionResultFixture(request));
    const worker = createExecutionWorker({ queue, repository, engine: { execute } });
    const job = await dispatch(queue, repository, request);

    const cancelled = await worker.cancel(job.jobId);
    const repeated = await worker.cancel(job.jobId);

    expect(cancelled).toMatchObject({ status: 'CANCELLED', startedAt: null });
    expect(repeated).toEqual(cancelled);
    expect(execute).not.toHaveBeenCalled();
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CREATED',
      job: { status: 'CANCELLED', startedAt: null },
    });
    expect(await worker.cancel(`job-${'f'.repeat(32)}`)).toBeNull();
  });

  it('propagates running cancellation through the job-owned AbortSignal', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const entered = deferred<AbortSignal>();
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        if (options?.signal === undefined) throw new Error('Expected a worker-owned signal.');
        const signal = options.signal;
        entered.resolve(signal);
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(createCancellationError(result)), {
            once: true,
          });
        });
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);
    worker.start();
    const signal = await entered.promise;

    await worker.cancel(job.jobId);
    await worker.drain();

    expect(signal.aborted).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('preserves cancellation requested between queue claim and worker activation', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    const queue: JobQueue = {
      ...baseQueue,
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const draining = worker.drain();
    await claimEntered.promise;
    await expect(worker.cancel(job.jobId)).resolves.toMatchObject({ status: 'RUNNING' });
    releaseClaim.resolve();
    await draining;

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('uses the authoritative cancel result when a stale queued read races with claim', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const secondGetCaptured = deferred<void>();
    const releaseSecondGet = deferred<void>();
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    let getCount = 0;
    const queue: JobQueue = {
      ...baseQueue,
      get: vi.fn(async (jobId) => {
        const snapshot = await baseQueue.get(jobId);
        getCount += 1;
        if (getCount === 2) {
          secondGetCaptured.resolve();
          await releaseSecondGet.promise;
        }
        return snapshot;
      }),
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const cancelling = worker.cancel(job.jobId);
    await secondGetCaptured.promise;
    const draining = worker.drain();
    await claimEntered.promise;
    releaseSecondGet.resolve();
    await expect(cancelling).resolves.toMatchObject({ status: 'CANCELLED' });
    releaseClaim.resolve();
    await draining;

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('shuts down idempotently, aborts the running job and persists queued cancellation', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const runningRequest = createWorkerExecutionRequestFixture(1);
    const queuedRequest = createWorkerExecutionRequestFixture(2);
    const cancelledResult = createCancelledExecutionResultFixture(runningRequest);
    const entered = deferred<AbortSignal>();
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        if (options?.signal === undefined) throw new Error('Expected a worker-owned signal.');
        const signal = options.signal;
        entered.resolve(signal);
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(createCancellationError(cancelledResult)), {
            once: true,
          });
        });
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const runningJob = await dispatch(queue, repository, runningRequest);
    const queuedJob = await dispatch(queue, repository, queuedRequest);
    worker.start();
    const signal = await entered.promise;

    await worker.shutdown();
    await worker.shutdown();

    expect(signal.aborted).toBe(true);
    expect(worker.isStarted()).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(runningJob.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await queue.get(queuedJob.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(runningJob.jobId)).toMatchObject({
      job: { status: 'CANCELLED' },
    });
    expect(await repository.findByJobId(queuedJob.jobId)).toMatchObject({
      job: { status: 'CANCELLED' },
    });
    expect(() => worker.start()).toThrowError(ExecutionWorkerError);
  });

  it('aborts a job claimed concurrently with shutdown before workflow execution starts', async () => {
    const baseQueue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const claimEntered = deferred<void>();
    const releaseClaim = deferred<void>();
    const queue: JobQueue = {
      ...baseQueue,
      claimNext: vi.fn(async () => {
        const claimed = await baseQueue.claimNext();
        claimEntered.resolve();
        await releaseClaim.promise;
        return claimed;
      }),
    };
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const result = createCancelledExecutionResultFixture(request);
    const execute = vi.fn(
      async (_request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult> => {
        expect(options?.signal?.aborted).toBe(true);
        throw createCancellationError(result);
      },
    );
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: persistentEngine({ execute }, repository),
    });
    const job = await dispatch(queue, repository, request);

    const draining = worker.drain();
    await claimEntered.promise;
    const shutdown = worker.shutdown();
    releaseClaim.resolve();
    await Promise.all([draining, shutdown]);

    expect(execute).toHaveBeenCalledOnce();
    expect(queue.isShutdown()).toBe(true);
    expect(await queue.get(job.jobId)).toMatchObject({ status: 'CANCELLED' });
    expect(await repository.findByJobId(job.jobId)).toMatchObject({
      status: 'CANCELLED',
      job: { status: 'CANCELLED' },
    });
  });

  it('reports a sanitized shutdown error when queued cancellation cannot be persisted', async () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) });
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const baseRepository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    await dispatch(queue, baseRepository, request);
    const repository: ExecutionRecordRepository = {
      ...baseRepository,
      markJobTerminal: vi.fn(async () =>
        Promise.reject(new Error('TOP-SECRET-SHUTDOWN-PERSISTENCE-CAUSE')),
      ),
    };
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: { execute: vi.fn() as unknown as ExecutionEngine['execute'] },
      logger,
    });

    await expect(worker.shutdown()).rejects.toMatchObject({
      code: EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED,
      message: 'Falha ao persistir o encerramento da fila.',
    });

    expect(queue.isShutdown()).toBe(true);
    expect(lines.join('\n')).toContain('execution.worker.shutdown.persistence.failed');
    expect(lines.join('\n')).toContain(EXECUTION_WORKER_ERROR_CODES.PERSISTENCE_FAILED);
    expect(lines.join('\n')).not.toContain('TOP-SECRET');
  });

  it('is start-idempotent and rejects invalid dependencies', async () => {
    expect(() =>
      createExecutionWorker({
        queue: {} as JobQueue,
        engine: {} as ExecutionEngine,
        repository: {} as ExecutionRecordRepository,
      }),
    ).toThrowError(ExecutionWorkerError);

    const queue = createInMemoryJobQueue();
    const repository = createInMemoryExecutionRecordRepository();
    const worker = createExecutionWorker({
      queue,
      repository,
      engine: { execute: vi.fn() as unknown as ExecutionEngine['execute'] },
    });
    worker.start();
    worker.start();
    await worker.drain();

    expect(worker.isStarted()).toBe(true);
    await worker.shutdown();
  });

  it('does not convert an arbitrary error carrying a result-like property into success', async () => {
    const queue = createInMemoryJobQueue({
      now: incrementalWorkerClock(EXECUTION_WORKER_FIXTURE_EPOCH, 1),
    });
    const repository = createInMemoryExecutionRecordRepository();
    const request = createWorkerExecutionRequestFixture();
    const execute = vi.fn(async () => {
      throw Object.assign(new Error('untrusted'), {
        result: await createSuccessfulExecutionResultFixture(request),
      });
    });
    const worker: ExecutionWorker = createExecutionWorker({
      queue,
      repository,
      engine: { execute },
    });
    const job = await dispatch(queue, repository, request);

    await worker.drain();

    expect(execute).toHaveBeenCalledOnce();
    expect(await queue.get(job.jobId)).toMatchObject({
      status: 'FAILED',
      failure: { code: EXECUTION_WORKER_ERROR_CODES.EXECUTION_FAILED },
    });
  });
});

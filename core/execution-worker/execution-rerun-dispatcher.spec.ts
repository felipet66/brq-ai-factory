import {
  createInMemoryExecutionRequestSnapshotRepository,
  type ExecutionRequestSnapshotRepository,
} from '@brq/execution-repository';
import { deriveExecutionIdentity } from '@brq/execution-engine';
import { jobRecordSchema, type JobRecord } from '@brq/job-queue';
import { describe, expect, it, vi } from 'vitest';

import type {
  CacheOnlyExecutionDispatcher,
  ExecutionDispatcher,
  ReplayCheckpointReader,
  ReplaySourceEligibilityReader,
} from './contracts';
import { createCacheOnlyExecutionDispatcher } from './cache-only-execution-dispatcher';
import {
  createExecutionRerunDispatcher,
  createRerunExecutionRequest,
} from './execution-rerun-dispatcher';
import { createSnapshottingExecutionDispatcher } from './snapshotting-execution-dispatcher';
import { createWorkerExecutionRequestFixture } from './testing/execution-worker-fixtures';

const SOURCE_CREATED_AT = '2026-08-12T18:00:00.000Z';
const RERUN_CREATED_AT = Date.parse('2026-08-12T18:01:00.000Z');
const RERUN_UUID = '10000000-0000-4000-8000-000000000002';

function checkpoints(complete = true): ReplayCheckpointReader {
  return {
    inspectExecution: vi.fn<ReplayCheckpointReader['inspectExecution']>(
      async ({ executionId, requiredAgents }) => ({
        executionId,
        complete,
        missingAgents: complete ? [] : [requiredAgents[0]!],
        checkpoints: complete
          ? requiredAgents.map((agent) => ({
              agent,
              provider: 'fake',
              requestHash: 'a'.repeat(64),
              responseHash: 'b'.repeat(64),
            }))
          : [],
      }),
    ),
  };
}

function eligibleSources(): ReplaySourceEligibilityReader {
  return {
    inspectExecution: vi.fn(async (executionId) => ({
      executionId,
      terminal: true,
      codeGeneratorSucceeded: true,
    })),
  };
}

function queuedJob(request: ReturnType<typeof createWorkerExecutionRequestFixture>): JobRecord {
  const identity = deriveExecutionIdentity(request);
  const jobId = `job-${identity.executionId.replace(/^execution-/, '')}`;
  const queuedAt = '2026-08-12T18:01:00.000Z';
  return jobRecordSchema.parse({
    jobId,
    executionId: identity.executionId,
    workflowId: request.workflowId,
    status: 'QUEUED',
    attempt: 1,
    queuedAt,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failure: null,
    events: [
      {
        sequence: 1,
        type: 'job.created',
        jobId,
        executionId: identity.executionId,
        workflowId: request.workflowId,
        status: 'QUEUED',
        occurredAt: queuedAt,
        durationMs: null,
        errorCode: null,
      },
    ],
  });
}

describe('execution rerun dispatcher', () => {
  it('adapts the queue dispatcher to explicit REQUIRE_HIT options', async () => {
    const request = createWorkerExecutionRequestFixture();
    const dispatchWithOptions = vi.fn(async () => queuedJob(request));
    const cacheOnly = createCacheOnlyExecutionDispatcher({
      dispatch: vi.fn(async () => queuedJob(request)),
      dispatchWithOptions,
    });

    await cacheOnly.dispatchCacheOnly(request, {
      mode: 'REQUIRE_CACHE_HIT',
      sourceExecutionId: `execution-${'f'.repeat(32)}`,
    });

    expect(dispatchWithOptions).toHaveBeenCalledWith(request, {
      cacheMode: 'REQUIRE_HIT',
      sourceExecutionId: `execution-${'f'.repeat(32)}`,
    });
  });

  it('creates a new technical identity while preserving the semantic request', () => {
    const source = createWorkerExecutionRequestFixture();
    const rerun = createRerunExecutionRequest(
      source,
      'request-10000000-0000-4000-8000-000000000002',
      RERUN_UUID,
    );

    expect(rerun).toMatchObject({
      deliveryIntent: source.deliveryIntent,
      demand: source.demand,
      additionalContext: source.additionalContext,
      workflowId: `workflow-${RERUN_UUID}`,
      requestId: 'request-10000000-0000-4000-8000-000000000002',
      traceId: `trace-${RERUN_UUID}`,
    });
    expect(rerun.agents.productOwner).toMatchObject({
      ...source.agents.productOwner,
      agentExecutionId: `product-owner-${RERUN_UUID}`,
    });
    expect(rerun.agents.developer.agentExecutionId).toBe(`developer-${RERUN_UUID}`);
    expect(rerun.agents.qa.agentExecutionId).toBe(`qa-${RERUN_UUID}`);
    expect(deriveExecutionIdentity(rerun).executionId).not.toBe(
      deriveExecutionIdentity(source).executionId,
    );
  });

  it('fails closed when the owner-scoped source snapshot does not exist', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>();
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: eligibleSources(),
      checkpoints: checkpoints(),
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory: () => RERUN_UUID,
    });

    await expect(
      dispatcher.dispatch({
        ownerId: 'owner-a',
        sourceExecutionId: `execution-${'a'.repeat(32)}`,
        requestId: 'request-10000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RERUN_SNAPSHOT_NOT_FOUND',
    });
    expect(dispatchCacheOnly).not.toHaveBeenCalled();
  });

  it('rejects an incomplete checkpoint set before creating or enqueueing the child', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const source = createWorkerExecutionRequestFixture();
    const sourceIdentity = deriveExecutionIdentity(source);
    await snapshots.save({
      ownerId: 'owner-a',
      request: source,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: SOURCE_CREATED_AT,
    });
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>();
    const idFactory = vi.fn(() => RERUN_UUID);
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: eligibleSources(),
      checkpoints: checkpoints(false),
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory,
    });

    await expect(
      dispatcher.dispatch({
        ownerId: 'owner-a',
        sourceExecutionId: sourceIdentity.executionId,
        requestId: 'request-10000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RERUN_REGENERATE_REQUIRED' });
    expect(idFactory).not.toHaveBeenCalled();
    expect(dispatchCacheOnly).not.toHaveBeenCalled();
  });

  it('rejects an ineligible source inside the service before checkpoint lookup or enqueue', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const source = createWorkerExecutionRequestFixture();
    const sourceIdentity = deriveExecutionIdentity(source);
    await snapshots.save({
      ownerId: 'owner-a',
      request: source,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: SOURCE_CREATED_AT,
    });
    const checkpointReader = checkpoints();
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>();
    const idFactory = vi.fn(() => RERUN_UUID);
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: {
        inspectExecution: vi.fn(async () => ({
          executionId: sourceIdentity.executionId,
          terminal: false,
          codeGeneratorSucceeded: false,
        })),
      },
      checkpoints: checkpointReader,
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory,
    });

    await expect(
      dispatcher.dispatch({
        ownerId: 'owner-a',
        sourceExecutionId: sourceIdentity.executionId,
        requestId: 'request-10000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RERUN_SOURCE_NOT_ELIGIBLE' });
    expect(checkpointReader.inspectExecution).not.toHaveBeenCalled();
    expect(idFactory).not.toHaveBeenCalled();
    expect(dispatchCacheOnly).not.toHaveBeenCalled();
  });

  it('dispatches only through REQUIRE_CACHE_HIT and reports usesOpenAI false', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const source = createWorkerExecutionRequestFixture();
    const sourceIdentity = deriveExecutionIdentity(source);
    await snapshots.save({
      ownerId: 'owner-a',
      request: source,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: SOURCE_CREATED_AT,
    });
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>(
      async (request) => queuedJob(request),
    );
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: eligibleSources(),
      checkpoints: checkpoints(),
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory: () => RERUN_UUID,
      now: () => RERUN_CREATED_AT,
    });

    const accepted = await dispatcher.dispatch({
      ownerId: 'owner-a',
      sourceExecutionId: sourceIdentity.executionId,
      requestId: 'request-10000000-0000-4000-8000-000000000002',
    });

    expect(dispatchCacheOnly).toHaveBeenCalledOnce();
    expect(dispatchCacheOnly.mock.calls[0]?.[1]).toEqual({
      mode: 'REQUIRE_CACHE_HIT',
      sourceExecutionId: sourceIdentity.executionId,
    });
    expect(accepted).toEqual({
      sourceExecutionId: sourceIdentity.executionId,
      executionId: expect.stringMatching(/^execution-[a-f0-9]{32}$/),
      jobId: expect.stringMatching(/^job-[a-f0-9]{32}$/),
      status: 'QUEUED',
      usesOpenAI: false,
    });
    expect(accepted.executionId).not.toBe(sourceIdentity.executionId);
    await expect(
      snapshots.findOwned({ ownerId: 'owner-a', executionId: accepted.executionId }),
    ).resolves.toMatchObject({
      replaySourceExecutionId: sourceIdentity.executionId,
      replayCacheExecutionId: sourceIdentity.executionId,
      replayMode: 'REQUIRE_CACHE_HIT',
    });
  });

  it('records the direct replay source while inheriting the original cache root', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const source = createWorkerExecutionRequestFixture();
    const sourceIdentity = deriveExecutionIdentity(source);
    const replayRootExecutionId = `execution-${'c'.repeat(32)}`;
    await snapshots.save({
      ownerId: 'owner-a',
      request: source,
      replaySourceExecutionId: `execution-${'b'.repeat(32)}`,
      replayCacheExecutionId: replayRootExecutionId,
      replayMode: 'REQUIRE_CACHE_HIT',
      createdAt: SOURCE_CREATED_AT,
    });
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>(
      async (request) => queuedJob(request),
    );
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: eligibleSources(),
      checkpoints: checkpoints(),
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory: () => RERUN_UUID,
      now: () => RERUN_CREATED_AT,
    });

    const accepted = await dispatcher.dispatch({
      ownerId: 'owner-a',
      sourceExecutionId: sourceIdentity.executionId,
      requestId: 'request-10000000-0000-4000-8000-000000000002',
    });

    await expect(
      snapshots.findOwned({ ownerId: 'owner-a', executionId: accepted.executionId }),
    ).resolves.toMatchObject({
      replaySourceExecutionId: sourceIdentity.executionId,
      replayCacheExecutionId: replayRootExecutionId,
      replayMode: 'REQUIRE_CACHE_HIT',
    });
    expect(dispatchCacheOnly).toHaveBeenCalledWith(expect.any(Object), {
      mode: 'REQUIRE_CACHE_HIT',
      sourceExecutionId: sourceIdentity.executionId,
    });
  });

  it('classifies a strict provider cache miss without retry or fallback', async () => {
    const snapshots = createInMemoryExecutionRequestSnapshotRepository();
    const source = createWorkerExecutionRequestFixture();
    const sourceIdentity = deriveExecutionIdentity(source);
    await snapshots.save({
      ownerId: 'owner-a',
      request: source,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: SOURCE_CREATED_AT,
    });
    const liveProvider = vi.fn();
    const dispatchCacheOnly = vi.fn<CacheOnlyExecutionDispatcher['dispatchCacheOnly']>(async () => {
      throw Object.assign(new Error('cache miss'), { code: 'AI_PROVIDER_CACHE_MISS' });
    });
    const dispatcher = createExecutionRerunDispatcher({
      snapshots,
      sourceEligibility: eligibleSources(),
      checkpoints: checkpoints(),
      cacheOnlyDispatcher: { dispatchCacheOnly },
      idFactory: () => RERUN_UUID,
      now: () => RERUN_CREATED_AT,
    });

    await expect(
      dispatcher.dispatch({
        ownerId: 'owner-a',
        sourceExecutionId: sourceIdentity.executionId,
        requestId: 'request-10000000-0000-4000-8000-000000000002',
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RERUN_REGENERATE_REQUIRED',
    });
    expect(dispatchCacheOnly).toHaveBeenCalledOnce();
    expect(liveProvider).not.toHaveBeenCalled();
  });

  it('captures the initial request before normal dispatch and stops on snapshot failure', async () => {
    const request = createWorkerExecutionRequestFixture();
    const dispatch = vi.fn<ExecutionDispatcher['dispatch']>(async (value) => queuedJob(value));
    const save = vi.fn<ExecutionRequestSnapshotRepository['save']>(async () => {
      throw new Error('snapshot unavailable');
    });
    const dispatcher = createSnapshottingExecutionDispatcher({
      dispatcher: { dispatch },
      snapshots: {
        save,
        findOwned: vi.fn<ExecutionRequestSnapshotRepository['findOwned']>(),
      },
      ownerId: 'owner-a',
      now: () => RERUN_CREATED_AT,
    });

    await expect(dispatcher.dispatch(request)).rejects.toThrow('snapshot unavailable');
    expect(save).toHaveBeenCalledWith({
      ownerId: 'owner-a',
      request,
      replaySourceExecutionId: null,
      replayCacheExecutionId: null,
      replayMode: null,
      createdAt: '2026-08-12T18:01:00.000Z',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

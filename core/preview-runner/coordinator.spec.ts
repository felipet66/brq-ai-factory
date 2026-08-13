import { describe, expect, it } from 'vitest';

import { createPreviewSessionCoordinator } from './coordinator';
import {
  PREVIEW_RUNNER_ERROR_CODES,
  PREVIEW_RUNNER_ERROR_STAGES,
  PreviewRunnerError,
} from './errors';
import { createInMemoryPreviewSessionStore } from './in-memory-store';
import { NODE_WEB_PREVIEW_24_V1_POLICY } from './policies';
import { createPreviewSessionEvent, transitionPreviewSession } from './session';
import {
  createFakePreviewRunner,
  createPreviewRuntimeObservationFixture,
  createPreviewStartRequestFixture,
  createResolvedPreviewFixture,
  incrementalPreviewClock,
} from './testing/preview-runner-fixtures';

const ignore = (): void => undefined;
const SILENT_LOGGER = { debug: ignore, info: ignore, warn: ignore, error: ignore };

describe('PreviewSessionCoordinator', () => {
  it('rejects invalid host configuration', () => {
    expect(() =>
      createPreviewSessionCoordinator({
        runner: undefined as never,
        store: createInMemoryPreviewSessionStore(),
        policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      }),
    ).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID }),
    );
  });

  it('executes Factory-approved start, health, idempotency, stop and cleanup lifecycle', async () => {
    const fake = createFakePreviewRunner();
    const store = createInMemoryPreviewSessionStore();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const request = createPreviewStartRequestFixture();
    const running = await coordinator.start(request);
    expect(running.status).toBe('RUNNING');
    expect(running.health).toBe('HEALTHY');
    expect(fake.startRequests).toHaveLength(1);
    expect(await coordinator.start(request)).toEqual(running);
    expect(fake.startRequests).toHaveLength(1);
    const stopped = await coordinator.stop(running.previewId);
    expect(stopped.status).toBe('STOPPED');
    expect(stopped.health).toBe('NOT_APPLICABLE');
    expect(fake.stopReasons).toEqual(['MANUAL']);
    expect(await coordinator.stop(running.previewId)).toEqual(stopped);
    expect((await store.listEvents(running.previewId)).map((event) => event.event)).toEqual([
      'preview.requested',
      'preview.starting',
      'preview.running',
      'preview.stopping',
      'preview.stopped',
    ]);
  });

  it('persists safe failure without retry when runtime start fails', async () => {
    const fake = createFakePreviewRunner();
    fake.setStartError(
      new PreviewRunnerError('sensitive runtime output', {
        code: PREVIEW_RUNNER_ERROR_CODES.HEALTHCHECK_FAILED,
        stage: PREVIEW_RUNNER_ERROR_STAGES.HEALTH,
        sourceCode: 'ECONNREFUSED /private/path',
      }),
    );
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const failed = await coordinator.start(createPreviewStartRequestFixture());
    expect(failed.status).toBe('FAILED');
    expect(failed.failure).toEqual({
      code: PREVIEW_RUNNER_ERROR_CODES.HEALTHCHECK_FAILED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.HEALTH,
      sourceCode: 'ECONNREFUSED__private_path',
      message: 'A sessão de Preview não pôde concluir esta etapa.',
    });
    expect(JSON.stringify(failed)).not.toContain('sensitive runtime output');
    expect(fake.startRequests).toHaveLength(0);
  });

  it('propagates cancellation to stop and confirms cleanup', async () => {
    const fake = createFakePreviewRunner();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const cancelled = await coordinator.start(createPreviewStartRequestFixture(), {
      signal: controller.signal,
    });
    expect(cancelled.status).toBe('STOPPED');
    expect(fake.stopReasons).toEqual(['CANCELLATION']);
  });

  it('cleans a returned runtime when persisting RUNNING fails and records the primary failure', async () => {
    const fake = createFakePreviewRunner();
    const baseStore = createInMemoryPreviewSessionStore();
    let rejectRunning = true;
    const store = {
      ...baseStore,
      async replace(...args: Parameters<typeof baseStore.replace>) {
        if (args[1].status === 'RUNNING' && rejectRunning) {
          rejectRunning = false;
          throw new Error('RUNNING persistence unavailable');
        }
        return baseStore.replace(...args);
      },
    };
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });

    const failed = await coordinator.start(createPreviewStartRequestFixture());

    expect(failed.status).toBe('FAILED');
    expect(failed.failure).toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.INTERNAL_ERROR,
      stage: PREVIEW_RUNNER_ERROR_STAGES.START,
    });
    expect(fake.startRequests).toHaveLength(1);
    expect(fake.stopReasons).toEqual(['RECONCILIATION']);
  });

  it('fails closed when cleanup after an unpersisted RUNNING runtime also fails', async () => {
    const fake = createFakePreviewRunner();
    fake.setStopError(new Error('cleanup unavailable'));
    const baseStore = createInMemoryPreviewSessionStore();
    let rejectRunning = true;
    const store = {
      ...baseStore,
      async replace(...args: Parameters<typeof baseStore.replace>) {
        if (args[1].status === 'RUNNING' && rejectRunning) {
          rejectRunning = false;
          throw new Error('RUNNING persistence unavailable');
        }
        return baseStore.replace(...args);
      },
    };
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });

    const failed = await coordinator.start(createPreviewStartRequestFixture());

    expect(failed.status).toBe('FAILED');
    expect(failed.failure).toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
      sourceCode: 'START_FAILURE_CLEANUP_FAILED',
    });
  });

  it('rejects a stop result correlated to another runtime', async () => {
    const fake = createFakePreviewRunner();
    const coordinator = createPreviewSessionCoordinator({
      runner: {
        ...fake.runner,
        async stop(request, options) {
          const result = await fake.runner.stop(request, options);
          return { ...result, executionId: 'execution-divergent' };
        },
      },
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());

    const failed = await coordinator.stop(running.previewId);

    expect(failed.status).toBe('FAILED');
    expect(failed.failure).toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED,
      stage: PREVIEW_RUNNER_ERROR_STAGES.CLEANUP,
    });
  });

  it('expires only after TTL and fails closed when cleanup fails', async () => {
    const fake = createFakePreviewRunner();
    let current = Date.parse('2026-08-10T12:01:00.000Z');
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: () => current,
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start({
      ...createPreviewStartRequestFixture(),
      limits: { ttlSeconds: 60 },
    });
    await expect(coordinator.expire(running.previewId)).rejects.toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT,
    });
    current = Date.parse(running.expiresAt);
    fake.setStopError(new Error('docker rm failed /private/path'));
    const failed = await coordinator.expire(running.previewId);
    expect(failed.status).toBe('FAILED');
    expect(failed.failure?.code).toBe(PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED);
    expect(failed.failure?.stage).toBe(PREVIEW_RUNNER_ERROR_STAGES.CLEANUP);
  });

  it('reconciles observed runtimes and reports lost runtimes deterministically', async () => {
    const fake = createFakePreviewRunner();
    const store = createInMemoryPreviewSessionStore();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());
    expect(await coordinator.reconcile(running.previewId)).toEqual(running);
    expect(fake.inspectRequests[0]).toMatchObject({
      previewId: running.previewId,
      executionId: running.executionId,
      expected: {
        artifactId: running.artifactId,
        expiresAt: running.expiresAt,
        sessionRevision: running.revision,
        previewSessionHash: running.hashes.previewSessionHash,
        policy: NODE_WEB_PREVIEW_24_V1_POLICY,
        limits: running.limits,
        runtime: running.provenance.runtime,
      },
    });
    fake.setInspection({
      previewId: running.previewId,
      executionId: running.executionId,
      status: 'MISSING',
      health: 'NOT_APPLICABLE',
      observedAt: '2026-08-10T12:02:00.000Z',
      runtime: null,
    });
    const failed = await coordinator.reconcile(running.previewId);
    expect(failed.status).toBe('FAILED');
    expect(failed.failure?.code).toBe(PREVIEW_RUNNER_ERROR_CODES.RUNTIME_LOST);
    expect(fake.stopReasons).toEqual(['RECONCILIATION']);
    expect(createPreviewRuntimeObservationFixture().adapter).toBe('FAKE');
  });

  it('rejects persisted session policy drift before inspecting the runtime', async () => {
    const fake = createFakePreviewRunner();
    const store = createInMemoryPreviewSessionStore();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());
    const driftedCoordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [{ ...NODE_WEB_PREVIEW_24_V1_POLICY, version: '1.0.1' }],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });

    await expect(driftedCoordinator.reconcile(running.previewId)).rejects.toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
      stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
      sourceCode: 'PERSISTED_SESSION_POLICY_MISMATCH',
    });
    expect(fake.inspectRequests).toHaveLength(0);
  });

  it('rejects runtime inspection correlated to another PreviewSession and cleans the current one', async () => {
    const fake = createFakePreviewRunner();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());
    fake.setInspection({
      previewId: 'preview-00000000000000000000000000000000',
      executionId: 'execution-divergent',
      status: 'RUNNING',
      health: 'HEALTHY',
      observedAt: '2026-08-10T12:02:00.000Z',
      runtime: createPreviewRuntimeObservationFixture(),
    });

    const failed = await coordinator.reconcile(running.previewId);

    expect(failed.status).toBe('FAILED');
    expect(failed.failure).toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_INTEGRITY_MISMATCH,
      stage: PREVIEW_RUNNER_ERROR_STAGES.RECONCILIATION,
      sourceCode: 'RUNTIME_CORRELATION_MISMATCH',
    });
    expect(fake.stopReasons).toEqual(['RECONCILIATION']);
  });

  it('records cleanup failure while reconciling a lost runtime', async () => {
    const fake = createFakePreviewRunner();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());
    fake.setInspection({
      previewId: running.previewId,
      executionId: running.executionId,
      status: 'UNHEALTHY',
      health: 'UNHEALTHY',
      observedAt: '2026-08-10T12:02:00.000Z',
      runtime: createPreviewRuntimeObservationFixture(),
    });
    fake.setStopError(new Error('cleanup unavailable'));
    const failed = await coordinator.reconcile(running.previewId);
    expect(failed.status).toBe('FAILED');
    expect(failed.failure?.code).toBe(PREVIEW_RUNNER_ERROR_CODES.CLEANUP_FAILED);
    expect(failed.failure?.stage).toBe(PREVIEW_RUNNER_ERROR_STAGES.CLEANUP);
  });

  it('rehydrates a STARTING session from a real runtime observation', async () => {
    const fake = createFakePreviewRunner();
    const store = createInMemoryPreviewSessionStore();
    const resolved = createResolvedPreviewFixture();
    await store.createOrGet(
      resolved.session,
      createPreviewSessionEvent(resolved.session, 'preview.requested', resolved.session.createdAt),
    );
    const starting = transitionPreviewSession({
      session: resolved.session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    await store.replace(
      resolved.session.revision,
      starting,
      createPreviewSessionEvent(starting, 'preview.starting', '2026-08-10T12:01:01.000Z'),
    );
    fake.setInspection({
      previewId: starting.previewId,
      executionId: starting.executionId,
      status: 'RUNNING',
      health: 'HEALTHY',
      observedAt: '2026-08-10T12:01:02.000Z',
      runtime: createPreviewRuntimeObservationFixture(),
    });
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    expect((await coordinator.reconcile(starting.previewId)).status).toBe('RUNNING');
  });

  it('returns NOT_FOUND for unknown control operations and reconciles terminal cleanup idempotently', async () => {
    const fake = createFakePreviewRunner();
    const coordinator = createPreviewSessionCoordinator({
      runner: fake.runner,
      store: createInMemoryPreviewSessionStore(),
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      now: incrementalPreviewClock(),
      logger: SILENT_LOGGER,
    });
    await expect(
      coordinator.stop('preview-00000000000000000000000000000000'),
    ).rejects.toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
    });
    await expect(
      coordinator.expire('preview-00000000000000000000000000000000'),
    ).rejects.toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
    });
    await expect(
      coordinator.reconcile('preview-00000000000000000000000000000000'),
    ).rejects.toMatchObject({
      code: PREVIEW_RUNNER_ERROR_CODES.NOT_FOUND,
    });
    const running = await coordinator.start(createPreviewStartRequestFixture());
    const stopped = await coordinator.stop(running.previewId);
    expect(await coordinator.reconcile(stopped.previewId)).toEqual(stopped);
    expect(fake.stopReasons).toEqual(['MANUAL', 'RECONCILIATION']);
  });
});

import {
  projectApprovedPreviewArtifactDescriptor,
  type ApprovedPreviewArtifactDescriptor,
} from '@brq/preview-artifact';
import { createApprovedPreviewArtifactFixture } from '@brq/preview-artifact/testing';

import type {
  ApprovedPreviewStartRequest,
  PreviewInspectRequest,
  PreviewRunner,
  PreviewRuntimeInspection,
  PreviewRuntimeObservation,
  PreviewSession,
  PreviewStartRequest,
} from '../contracts';
import { calculatePreviewRuntimeHash } from '../hashing';
import { NODE_WEB_PREVIEW_24_V1_POLICY } from '../policies';
import { resolvePreviewStart, transitionPreviewSession } from '../session';

export function createApprovedPreviewArtifactDescriptorFixture(): ApprovedPreviewArtifactDescriptor {
  return projectApprovedPreviewArtifactDescriptor(createApprovedPreviewArtifactFixture());
}

export function createPreviewStartRequestFixture(): PreviewStartRequest {
  return {
    executionId: 'execution-preview-fixture-001',
    artifact: createApprovedPreviewArtifactDescriptorFixture(),
    policyId: 'NODE_WEB_PREVIEW_24_V1',
  };
}

export function createPreviewRuntimeObservationFixture(): PreviewRuntimeObservation {
  return {
    adapter: 'FAKE',
    engineName: 'FAKE_RUNTIME',
    engineVersion: '1.0.0',
    imageReference: `registry.example/brq/preview@sha256:${'e'.repeat(64)}`,
    imageDigest: `sha256:${'e'.repeat(64)}`,
    imageId: `sha256:${'f'.repeat(64)}`,
    platform: 'linux/arm64',
    runtimeName: 'NODE',
    runtimeVersion: '24.19.0',
    serverAbiVersion: '1.0.0',
  };
}

export function createResolvedPreviewFixture(): {
  readonly request: ApprovedPreviewStartRequest;
  readonly session: PreviewSession;
} {
  return resolvePreviewStart({
    request: createPreviewStartRequestFixture(),
    policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
    observedAt: '2026-08-10T12:01:00.000Z',
  });
}

export function createRunningPreviewSessionFixture(): PreviewSession {
  const resolved = createResolvedPreviewFixture();
  const starting = transitionPreviewSession({
    session: resolved.session,
    status: 'STARTING',
    observedAt: '2026-08-10T12:01:01.000Z',
  });
  return transitionPreviewSession({
    session: starting,
    status: 'RUNNING',
    observedAt: '2026-08-10T12:01:02.000Z',
    runtime: createPreviewRuntimeObservationFixture(),
  });
}

export interface FakePreviewRunnerControls {
  readonly runner: PreviewRunner;
  readonly startRequests: ApprovedPreviewStartRequest[];
  readonly inspectRequests: PreviewInspectRequest[];
  readonly stopReasons: string[];
  setStartError(error: unknown): void;
  setStopError(error: unknown): void;
  setInspection(inspection: PreviewRuntimeInspection): void;
}

export function createFakePreviewRunner(): FakePreviewRunnerControls {
  const startRequests: ApprovedPreviewStartRequest[] = [];
  const inspectRequests: PreviewInspectRequest[] = [];
  const stopReasons: string[] = [];
  let startError: unknown;
  let stopError: unknown;
  let inspection: PreviewRuntimeInspection | undefined;
  const runtime = createPreviewRuntimeObservationFixture();
  const runner: PreviewRunner = {
    async start(request, options) {
      if (options?.signal?.aborted) throw options.signal.reason;
      if (startError !== undefined) throw startError;
      startRequests.push(request);
      inspection = {
        previewId: request.previewId,
        executionId: request.executionId,
        status: 'RUNNING',
        health: 'HEALTHY',
        observedAt: new Date(Date.parse(request.createdAt) + 1000).toISOString(),
        runtime,
      };
      return {
        previewId: request.previewId,
        executionId: request.executionId,
        status: 'RUNNING',
        health: {
          status: 'HEALTHY',
          observedAt: new Date(Date.parse(request.createdAt) + 1000).toISOString(),
        },
        startedAt: new Date(Date.parse(request.createdAt) + 1000).toISOString(),
        expiresAt: request.expiresAt,
        runtime,
        runtimeHash: calculatePreviewRuntimeHash(runtime),
      };
    },
    async inspect(request) {
      inspectRequests.push(request);
      return (
        inspection ?? {
          previewId: request.previewId,
          executionId: request.executionId,
          status: 'MISSING',
          health: 'NOT_APPLICABLE',
          observedAt: '2026-08-10T12:01:05.000Z',
          runtime: null,
        }
      );
    },
    async stop(request) {
      if (stopError !== undefined) throw stopError;
      stopReasons.push(request.reason);
      inspection = {
        previewId: request.previewId,
        executionId: request.executionId,
        status: 'MISSING',
        health: 'NOT_APPLICABLE',
        observedAt: '2026-08-10T12:01:06.000Z',
        runtime: null,
      };
      return {
        previewId: request.previewId,
        executionId: request.executionId,
        stoppedAt: '2026-08-10T12:01:06.000Z',
        cleanupConfirmed: true,
        alreadyAbsent: false,
      };
    },
  };
  return {
    runner,
    startRequests,
    inspectRequests,
    stopReasons,
    setStartError(error) {
      startError = error;
    },
    setStopError(error) {
      stopError = error;
    },
    setInspection(value) {
      inspection = value;
    },
  };
}

export function incrementalPreviewClock(
  start = Date.parse('2026-08-10T12:01:00.000Z'),
): () => number {
  let value = start;
  return () => {
    const observed = value;
    value += 1000;
    return observed;
  };
}

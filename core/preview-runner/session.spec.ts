import { describe, expect, it } from 'vitest';

import { PREVIEW_RUNNER_ERROR_CODES } from './errors';
import {
  calculatePreviewLineageHash,
  calculatePreviewLimitsHash,
  calculatePreviewPolicyHash,
  calculatePreviewRequestHash,
  derivePreviewId,
} from './hashing';
import { NODE_WEB_PREVIEW_24_V1_POLICY } from './policies';
import { previewSessionSchema } from './schemas';
import {
  createPreviewSessionEvent,
  resolvePreviewStart,
  transitionPreviewSession,
} from './session';
import {
  createPreviewRuntimeObservationFixture,
  createPreviewStartRequestFixture,
  createResolvedPreviewFixture,
} from './testing/preview-runner-fixtures';

describe('Preview session contracts', () => {
  it('resolves host-owned policy, limits and deterministic hashes', () => {
    const first = createResolvedPreviewFixture();
    const second = createResolvedPreviewFixture();
    expect(first).toEqual(second);
    expect(first.session.status).toBe('CREATED');
    expect(first.session.health).toBe('PENDING');
    expect(first.session.hashes.policyHash).toBe(
      calculatePreviewPolicyHash(NODE_WEB_PREVIEW_24_V1_POLICY),
    );
    expect(first.session.hashes.limitsHash).toBe(calculatePreviewLimitsHash(first.session.limits));
    expect(first.session.hashes.previewRequestHash).toBe(
      calculatePreviewRequestHash({
        executionId: first.request.executionId,
        artifact: first.request.artifact,
        policyId: first.request.policy.policyId,
        policyHash: first.session.hashes.policyHash,
        effectiveLimits: first.request.effectiveLimits,
      }),
    );
    expect(first.session.previewId).toBe(derivePreviewId(first.session.hashes.previewRequestHash));
    expect(first.session.hashes.lineageHash).toBe(
      calculatePreviewLineageHash(first.session.lineage),
    );
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('applies only reductions and rejects expired or divergent artifacts', () => {
    const request = createPreviewStartRequestFixture();
    const reduced = resolvePreviewStart({
      request: { ...request, limits: { ttlSeconds: 120, responseBytes: 1024 } },
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      observedAt: '2026-08-10T12:01:00.000Z',
    });
    expect(reduced.session.limits.ttlSeconds).toBe(120);
    expect(reduced.session.limits.responseBytes).toBe(1024);
    const capped = resolvePreviewStart({
      request,
      policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
      observedAt: '2026-08-10T12:29:00.000Z',
    });
    expect(capped.session.expiresAt).toBe(request.artifact.expiresAt);
    expect(() =>
      resolvePreviewStart({
        request,
        policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
        observedAt: '2026-08-10T12:29:00.001Z',
      }),
    ).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE }),
    );
    expect(() =>
      resolvePreviewStart({
        request,
        policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
        observedAt: request.artifact.expiresAt,
      }),
    ).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.ARTIFACT_UNAVAILABLE }),
    );
    expect(() =>
      resolvePreviewStart({
        request: { ...request, executionId: 'execution-divergent' },
        policies: [NODE_WEB_PREVIEW_24_V1_POLICY],
        observedAt: '2026-08-10T12:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.INVALID_REQUEST }));
  });

  it('enforces the state machine and immutable event ordering', () => {
    const resolved = createResolvedPreviewFixture();
    const starting = transitionPreviewSession({
      session: resolved.session,
      status: 'STARTING',
      observedAt: '2026-08-10T12:01:01.000Z',
    });
    const running = transitionPreviewSession({
      session: starting,
      status: 'RUNNING',
      observedAt: '2026-08-10T12:01:02.000Z',
      runtime: createPreviewRuntimeObservationFixture(),
    });
    expect(previewSessionSchema.parse(running)).toEqual(running);
    expect(running.provenance.runtime?.adapter).toBe('FAKE');
    const event = createPreviewSessionEvent(running, 'preview.running', running.startedAt!);
    expect(event.sequence).toBe(3);
    expect(event.failureCode).toBeNull();
    expect(Object.isFrozen(event)).toBe(true);
    expect(() =>
      transitionPreviewSession({
        session: running,
        status: 'STARTING',
        observedAt: '2026-08-10T12:01:03.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.CONFLICT }));
  });
});

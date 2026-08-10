import { describe, expect, it } from 'vitest';

import { resolvePreviewLimits } from './configuration';
import { PREVIEW_RUNNER_ERROR_CODES } from './errors';
import { canTransitionPreviewSession, isPreviewTerminalStatus } from './lifecycle';
import { NODE_WEB_PREVIEW_24_V1_POLICY, resolvePreviewPolicy } from './policies';
import {
  approvedPreviewStartRequestSchema,
  previewRuntimeResultSchema,
  previewSessionEventSchema,
  previewStartRequestSchema,
} from './schemas';
import {
  createPreviewRuntimeObservationFixture,
  createPreviewStartRequestFixture,
  createResolvedPreviewFixture,
} from './testing';
import {
  calculatePreviewLimitsHash,
  calculatePreviewPolicyHash,
  calculatePreviewProvenanceHash,
  calculatePreviewRequestHash,
  calculatePreviewRuntimeHash,
  calculatePreviewSessionHash,
  derivePreviewId,
} from './hashing';
import {
  PREVIEW_RUNNER_CONTRACT_VERSION,
  PREVIEW_RUNNER_HASH_ALGORITHM,
  PREVIEW_RUNNER_VERSION,
} from './version';

describe('Preview Runner public contracts', () => {
  it('keeps the lifecycle strict and terminal', () => {
    expect(canTransitionPreviewSession('CREATED', 'STARTING')).toBe(true);
    expect(canTransitionPreviewSession('RUNNING', 'STOPPING')).toBe(true);
    expect(canTransitionPreviewSession('STOPPED', 'STARTING')).toBe(false);
    expect(isPreviewTerminalStatus('FAILED')).toBe(true);
    expect(isPreviewTerminalStatus('RUNNING')).toBe(false);
  });

  it('resolves only registered strict policies and rejects drift', () => {
    expect(resolvePreviewPolicy([NODE_WEB_PREVIEW_24_V1_POLICY], 'NODE_WEB_PREVIEW_24_V1')).toEqual(
      NODE_WEB_PREVIEW_24_V1_POLICY,
    );
    expect(() => resolvePreviewPolicy([], 'NODE_WEB_PREVIEW_24_V1')).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID }),
    );
    expect(() => resolvePreviewPolicy([NODE_WEB_PREVIEW_24_V1_POLICY], 'UNKNOWN')).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.POLICY_MISMATCH }),
    );
    expect(() =>
      resolvePreviewPolicy(
        [NODE_WEB_PREVIEW_24_V1_POLICY, NODE_WEB_PREVIEW_24_V1_POLICY],
        'NODE_WEB_PREVIEW_24_V1',
      ),
    ).toThrowError(
      expect.objectContaining({ code: PREVIEW_RUNNER_ERROR_CODES.CONFIGURATION_INVALID }),
    );
  });

  it('allows only bounded reductions and rejects expansion', () => {
    expect(resolvePreviewLimits(NODE_WEB_PREVIEW_24_V1_POLICY.limits, undefined).ttlSeconds).toBe(
      600,
    );
    expect(
      resolvePreviewLimits(NODE_WEB_PREVIEW_24_V1_POLICY.limits, { ttlSeconds: 60 }).ttlSeconds,
    ).toBe(60);
    expect(() =>
      resolvePreviewLimits(NODE_WEB_PREVIEW_24_V1_POLICY.limits, { ttlSeconds: 901 }),
    ).toThrow();
  });

  it('rejects request, runtime and event contract extensions or tampering', () => {
    const request = createPreviewStartRequestFixture();
    expect(previewStartRequestSchema.safeParse({ ...request, image: 'latest' }).success).toBe(
      false,
    );
    const resolved = createResolvedPreviewFixture();
    const runtime = createPreviewRuntimeObservationFixture();
    const runtimeResult = {
      previewId: resolved.session.previewId,
      executionId: resolved.session.executionId,
      status: 'RUNNING',
      health: { status: 'HEALTHY', observedAt: '2026-08-10T12:01:01.000Z' },
      startedAt: '2026-08-10T12:01:01.000Z',
      expiresAt: resolved.session.expiresAt,
      runtime,
      runtimeHash: calculatePreviewRuntimeHash(runtime),
    };
    expect(previewRuntimeResultSchema.parse(runtimeResult)).toEqual(runtimeResult);
    expect(
      previewRuntimeResultSchema.safeParse({ ...runtimeResult, runtimeHash: '0'.repeat(64) })
        .success,
    ).toBe(false);
    const event = {
      previewId: resolved.session.previewId,
      executionId: resolved.session.executionId,
      sequence: 1,
      event: 'preview.requested',
      status: 'CREATED',
      occurredAt: resolved.session.createdAt,
      durationMs: 0,
      policyId: resolved.session.policy.id,
      hashes: {
        artifactHash: resolved.session.hashes.artifactHash,
        previewRequestHash: resolved.session.hashes.previewRequestHash,
        previewSessionHash: resolved.session.hashes.previewSessionHash,
      },
      failureCode: null,
      contractVersion: '1.0.0',
    };
    expect(previewSessionEventSchema.parse(event)).toEqual(event);
    expect(previewSessionEventSchema.safeParse({ ...event, prompt: 'secret' }).success).toBe(false);
    expect(
      previewSessionEventSchema.safeParse({ ...event, event: 'preview.running' }).success,
    ).toBe(false);
  });

  it.each([
    ['preview.requested', 'CREATED'],
    ['preview.starting', 'STARTING'],
    ['preview.running', 'RUNNING'],
    ['preview.failed', 'FAILED'],
    ['preview.stopping', 'STOPPING'],
    ['preview.stopped', 'STOPPED'],
    ['preview.expired', 'EXPIRED'],
  ] as const)('binds the %s event to the %s status', (eventName, status) => {
    const resolved = createResolvedPreviewFixture();
    const event = {
      previewId: resolved.session.previewId,
      executionId: resolved.session.executionId,
      sequence: 1,
      event: eventName,
      status,
      occurredAt: resolved.session.createdAt,
      durationMs: 0,
      policyId: resolved.session.policy.id,
      hashes: {
        artifactHash: resolved.session.hashes.artifactHash,
        previewRequestHash: resolved.session.hashes.previewRequestHash,
        previewSessionHash: resolved.session.hashes.previewSessionHash,
      },
      failureCode: null,
      contractVersion: '1.0.0',
    };
    expect(previewSessionEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects resolved start hash, expiry and canonical policy tampering', () => {
    const resolved = createResolvedPreviewFixture();
    expect(approvedPreviewStartRequestSchema.parse(resolved.request)).toEqual(resolved.request);

    for (const hashName of [
      'factoryResultHash',
      'sandboxRequestHash',
      'sandboxResultHash',
      'workspaceHash',
      'artifactHash',
      'artifactApprovalHash',
      'provenanceHash',
    ] as const) {
      expect(
        approvedPreviewStartRequestSchema.safeParse({
          ...resolved.request,
          hashes: { ...resolved.request.hashes, [hashName]: '0'.repeat(64) },
        }).success,
      ).toBe(false);
    }
    expect(
      approvedPreviewStartRequestSchema.safeParse({
        ...resolved.request,
        expiresAt: '2030-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);

    const policy = {
      ...resolved.request.policy,
      limits: { ...resolved.request.policy.limits, ttlSeconds: 900 },
    };
    const effectiveLimits = { ...resolved.request.effectiveLimits, ttlSeconds: 900 };
    const policyHash = calculatePreviewPolicyHash(policy);
    const limitsHash = calculatePreviewLimitsHash(effectiveLimits);
    const previewRequestHash = calculatePreviewRequestHash({
      executionId: resolved.request.executionId,
      artifact: resolved.request.artifact,
      policyId: policy.policyId,
      policyHash,
      effectiveLimits,
    });
    const previewId = derivePreviewId(previewRequestHash);
    const previewSessionHash = calculatePreviewSessionHash({
      previewId,
      executionId: resolved.request.executionId,
      artifactId: resolved.request.artifact.artifactId,
      previewRequestHash,
      policyHash,
      limitsHash,
      lineageHash: resolved.request.hashes.lineageHash,
    });
    const provenanceHash = calculatePreviewProvenanceHash({
      runnerVersion: PREVIEW_RUNNER_VERSION,
      contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
      hashAlgorithm: PREVIEW_RUNNER_HASH_ALGORITHM,
      artifactVersion: resolved.request.artifact.metadata.artifactVersion,
      artifactContractVersion: resolved.request.artifact.metadata.contractVersion,
      exporterVersion: resolved.request.artifact.metadata.exporterVersion,
      policyId: policy.policyId,
      policyVersion: policy.version,
      policyHash,
      limitsHash,
      runtime: null,
    });
    expect(
      approvedPreviewStartRequestSchema.safeParse({
        ...resolved.request,
        previewId,
        policy,
        effectiveLimits,
        expiresAt: new Date(Date.parse(resolved.request.createdAt) + 900_000).toISOString(),
        hashes: {
          ...resolved.request.hashes,
          policyHash,
          limitsHash,
          previewRequestHash,
          provenanceHash,
          previewSessionHash,
        },
      }).success,
    ).toBe(false);
  });
});

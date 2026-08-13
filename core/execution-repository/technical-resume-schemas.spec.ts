import { describe, expect, it } from 'vitest';
import { createFactoryTechnicalCheckpointFixture } from '@brq/factory-pipeline/testing';

import { createFactoryTechnicalResumeResultFixture } from './testing/technical-resume-fixtures';
import {
  factoryTechnicalResumeAttemptFailInputSchema,
  factoryTechnicalResumeAttemptRecordSchema,
} from './technical-resume-schemas';

const ATTEMPT_ID = 'technical-resume-123e4567-e89b-42d3-a456-426614174000';

describe('technical resume attempt schema', () => {
  const checkpoint = createFactoryTechnicalCheckpointFixture();
  const base = {
    attemptId: ATTEMPT_ID,
    checkpointHash: checkpoint.checkpointHash,
    ownerId: 'owner-technical-resume',
    requestId: 'request-technical-resume',
    startedAt: '2026-08-13T12:00:01.000Z',
    heartbeatAt: '2026-08-13T12:00:01.000Z',
    leaseExpiresAt: '2026-08-13T12:01:01.000Z',
    completionRecordedAt: null,
  } as const;

  it('accepts only coherent active and terminal lifecycle states', () => {
    const success = createFactoryTechnicalResumeResultFixture({ checkpoint });
    const cancelled = createFactoryTechnicalResumeResultFixture({
      checkpoint,
      status: 'CANCELLED',
    });

    expect(
      factoryTechnicalResumeAttemptRecordSchema.safeParse({
        ...base,
        status: 'RUNNING',
        activePhase: 'EXECUTING',
        finishedAt: null,
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: null,
        recoveryReasonCode: null,
      }).success,
    ).toBe(true);
    expect(
      factoryTechnicalResumeAttemptRecordSchema.safeParse({
        ...base,
        status: 'SUCCESS',
        activePhase: null,
        finishedAt: success.finishedAt,
        result: success,
        cleanupConfirmed: true,
        failureReasonCode: null,
        recoveryReasonCode: null,
      }).success,
    ).toBe(true);
    expect(
      factoryTechnicalResumeAttemptRecordSchema.safeParse({
        ...base,
        status: 'FAILED',
        activePhase: null,
        finishedAt: '2026-08-13T12:00:03.000Z',
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: 'TECHNICAL_RESUME_INTERNAL_ERROR',
        recoveryReasonCode: null,
      }).success,
    ).toBe(true);
    expect(
      factoryTechnicalResumeAttemptRecordSchema.safeParse({
        ...base,
        status: 'CANCELLED',
        activePhase: null,
        finishedAt: cancelled.finishedAt,
        result: cancelled,
        cleanupConfirmed: true,
        failureReasonCode: cancelled.failure?.reasonCode,
        recoveryReasonCode: null,
      }).success,
    ).toBe(true);
  });

  it('rejects contradictions between status, timestamps, result and failure reason', () => {
    const result = createFactoryTechnicalResumeResultFixture({ checkpoint });
    const valid = {
      ...base,
      status: 'SUCCESS' as const,
      activePhase: null,
      finishedAt: result.finishedAt,
      result,
      cleanupConfirmed: true,
      failureReasonCode: null,
      recoveryReasonCode: null,
    };

    const invalid = [
      { ...valid, status: 'RUNNING', result: null },
      { ...valid, result: null },
      { ...valid, finishedAt: '2026-08-13T11:59:59.000Z' },
      { ...valid, attemptId: 'technical-resume-223e4567-e89b-42d3-a456-426614174000' },
      { ...valid, checkpointHash: 'f'.repeat(64) },
      { ...valid, status: 'FAILED', failureReasonCode: 'SANDBOX_FAILED' },
      {
        ...base,
        status: 'FAILED',
        finishedAt: result.finishedAt,
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: null,
      },
      {
        ...base,
        status: 'CANCELLED',
        finishedAt: result.finishedAt,
        result: null,
        cleanupConfirmed: false,
        failureReasonCode: 'CANCELLED',
      },
    ];

    for (const candidate of invalid) {
      expect(factoryTechnicalResumeAttemptRecordSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it('allows cleanup confirmation without a result only for deterministic pre-physical failures', () => {
    const baseFailure = {
      attemptId: ATTEMPT_ID,
      leaseId: 'technical-lease-123e4567-e89b-42d3-a456-426614174000',
      leaseVersion: 1,
      finishedAt: '2026-08-13T12:00:03.000Z',
    };
    expect(
      factoryTechnicalResumeAttemptFailInputSchema.safeParse({
        ...baseFailure,
        reasonCode: 'CHECKPOINT_PROFILE_DRIFT',
        cleanupConfirmed: true,
      }).success,
    ).toBe(true);
    expect(
      factoryTechnicalResumeAttemptFailInputSchema.safeParse({
        ...baseFailure,
        reasonCode: 'RUNTIME_PREFLIGHT_FAILED',
        cleanupConfirmed: true,
      }).success,
    ).toBe(true);
    expect(
      factoryTechnicalResumeAttemptFailInputSchema.safeParse({
        ...baseFailure,
        reasonCode: 'SANDBOX_FAILED',
        cleanupConfirmed: true,
      }).success,
    ).toBe(false);
  });
});

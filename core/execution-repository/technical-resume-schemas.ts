import {
  factoryTechnicalCheckpointSchema,
  factoryTechnicalResumeResultSchema,
} from '@brq/factory-pipeline';
import { identifierSchema, isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

const HASH = /^[a-f0-9]{64}$/u;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{1,127}$/u;

export function isTechnicalResumePrePhysicalFailure(reasonCode: string): boolean {
  return reasonCode.startsWith('CHECKPOINT_') || reasonCode === 'RUNTIME_PREFLIGHT_FAILED';
}

export function isTechnicalResumeResultCleanupConfirmed(result: {
  readonly workspace: { readonly releaseStatus: string };
  readonly sandbox: { readonly cleanupFailure: unknown | null };
}): boolean {
  return (
    (result.workspace.releaseStatus === 'RELEASED' ||
      result.workspace.releaseStatus === 'NOT_REQUIRED') &&
    result.sandbox.cleanupFailure === null
  );
}

export const factoryTechnicalCheckpointSaveInputSchema = z
  .object({
    checkpoint: factoryTechnicalCheckpointSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const factoryTechnicalCheckpointLookupSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(128),
    sourceExecutionId: identifierSchema,
  })
  .strict();

export const factoryTechnicalResumeAttemptLookupSchema = factoryTechnicalCheckpointLookupSchema;

export const factoryTechnicalCleanupAttestationSchema = z
  .object({
    factoryResultHash: z.string().regex(HASH),
    releaseStatus: z.enum(['RELEASED', 'NOT_REQUIRED']),
    completedAt: isoDateTimeSchema,
  })
  .strict();

export const factoryTechnicalCheckpointRecordSchema = z
  .object({
    checkpoint: factoryTechnicalCheckpointSchema,
    createdAt: isoDateTimeSchema,
    cleanup: factoryTechnicalCleanupAttestationSchema.nullable(),
  })
  .strict();

export const factoryTechnicalResumeAttemptStatusSchema = z.enum([
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
]);

export const factoryTechnicalResumeAttemptActivePhaseSchema = z.enum([
  'EXECUTING',
  'COMPLETION_PENDING',
  'RECOVERY_REQUIRED',
]);

export const factoryTechnicalResumeAttemptCreateInputSchema = z
  .object({
    attemptId: identifierSchema,
    checkpointHash: z.string().regex(HASH),
    ownerId: z.string().trim().min(1).max(128),
    requestId: identifierSchema,
    startedAt: isoDateTimeSchema,
    leaseId: identifierSchema,
    leaseVersion: z.number().int().positive(),
    heartbeatAt: isoDateTimeSchema,
    leaseExpiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((attempt, context) => {
    if (
      Date.parse(attempt.heartbeatAt) < Date.parse(attempt.startedAt) ||
      Date.parse(attempt.leaseExpiresAt) <= Date.parse(attempt.heartbeatAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['leaseExpiresAt'],
        message: 'A lease deve iniciar após startedAt e expirar depois do heartbeat.',
      });
    }
  });

export const factoryTechnicalResumeAttemptHeartbeatInputSchema = z
  .object({
    attemptId: identifierSchema,
    leaseId: identifierSchema,
    leaseVersion: z.number().int().positive(),
    heartbeatAt: isoDateTimeSchema,
    leaseExpiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((heartbeat, context) => {
    if (Date.parse(heartbeat.leaseExpiresAt) <= Date.parse(heartbeat.heartbeatAt)) {
      context.addIssue({
        code: 'custom',
        path: ['leaseExpiresAt'],
        message: 'A lease renovada deve expirar depois do heartbeat.',
      });
    }
  });

export const factoryTechnicalResumeAttemptStageResultInputSchema = z
  .object({
    attemptId: identifierSchema,
    leaseId: identifierSchema,
    leaseVersion: z.number().int().positive(),
    recordedAt: isoDateTimeSchema,
    result: factoryTechnicalResumeResultSchema,
  })
  .strict();

export const factoryTechnicalResumeAttemptCompleteInputSchema = z
  .object({
    attemptId: identifierSchema,
    pendingResultHash: z.string().regex(HASH),
  })
  .strict();

export const factoryTechnicalResumeAttemptReconcileInputSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(128),
    sourceExecutionId: identifierSchema,
    observedAt: isoDateTimeSchema,
  })
  .strict();

export const factoryTechnicalResumeReconciliationOutcomeSchema = z.enum([
  'NONE',
  'TERMINAL',
  'ACTIVE',
  'FINALIZED',
  'RECOVERY_REQUIRED',
]);

export const factoryTechnicalResumeAttemptFailInputSchema = z
  .object({
    attemptId: identifierSchema,
    leaseId: identifierSchema,
    leaseVersion: z.number().int().positive(),
    finishedAt: isoDateTimeSchema,
    reasonCode: z.string().regex(SAFE_REASON_CODE),
    cleanupConfirmed: z.boolean(),
  })
  .strict()
  .superRefine((failure, context) => {
    if (failure.cleanupConfirmed !== isTechnicalResumePrePhysicalFailure(failure.reasonCode)) {
      context.addIssue({
        code: 'custom',
        path: ['cleanupConfirmed'],
        message: 'cleanupConfirmed deve corresponder à classe pré-física do motivo.',
      });
    }
  });

export const factoryTechnicalResumeAttemptRecordSchema = z
  .object({
    attemptId: identifierSchema,
    checkpointHash: z.string().regex(HASH),
    ownerId: z.string().trim().min(1).max(128),
    requestId: identifierSchema,
    status: factoryTechnicalResumeAttemptStatusSchema,
    activePhase: factoryTechnicalResumeAttemptActivePhaseSchema.nullable(),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.nullable(),
    heartbeatAt: isoDateTimeSchema.nullable(),
    leaseExpiresAt: isoDateTimeSchema.nullable(),
    completionRecordedAt: isoDateTimeSchema.nullable(),
    result: factoryTechnicalResumeResultSchema.nullable(),
    cleanupConfirmed: z.boolean(),
    failureReasonCode: z.string().regex(SAFE_REASON_CODE).nullable(),
    recoveryReasonCode: z.string().regex(SAFE_REASON_CODE).nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    const terminal = attempt.status !== 'RUNNING';
    if (terminal === (attempt.finishedAt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Tentativas terminais exigem finishedAt; RUNNING não pode possuí-lo.',
      });
    }
    if (
      attempt.finishedAt !== null &&
      Date.parse(attempt.finishedAt) < Date.parse(attempt.startedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'finishedAt não pode anteceder startedAt.',
      });
    }

    if (attempt.result !== null) {
      if (attempt.cleanupConfirmed !== isTechnicalResumeResultCleanupConfirmed(attempt.result)) {
        context.addIssue({
          code: 'custom',
          path: ['cleanupConfirmed'],
          message: 'cleanupConfirmed deve refletir release e cleanup do resultado.',
        });
      }
      if (attempt.result.attemptId !== attempt.attemptId) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'attemptId'],
          message: 'O resultado deve pertencer à tentativa persistida.',
        });
      }
      if (attempt.result.checkpointHash !== attempt.checkpointHash) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'checkpointHash'],
          message: 'O resultado deve pertencer ao checkpoint persistido.',
        });
      }
      if (attempt.result.status !== attempt.status) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'status'],
          message: 'O status do resultado deve corresponder ao status da tentativa.',
        });
      }
      if (attempt.result.finishedAt !== attempt.finishedAt) {
        context.addIssue({
          code: 'custom',
          path: ['result', 'finishedAt'],
          message: 'O término do resultado deve corresponder ao término persistido.',
        });
      }
    }

    if (attempt.status === 'RUNNING') {
      if (attempt.activePhase === null) {
        context.addIssue({
          code: 'custom',
          path: ['activePhase'],
          message: 'Uma tentativa RUNNING exige fase ativa.',
        });
      }
      if (attempt.cleanupConfirmed) {
        context.addIssue({
          code: 'custom',
          path: ['cleanupConfirmed'],
          message: 'Uma tentativa RUNNING não pode confirmar cleanup.',
        });
      }
      if (attempt.result !== null) {
        context.addIssue({
          code: 'custom',
          path: ['result'],
          message: 'Uma tentativa RUNNING não pode possuir resultado terminal.',
        });
      }
      if (attempt.failureReasonCode !== null) {
        context.addIssue({
          code: 'custom',
          path: ['failureReasonCode'],
          message: 'Uma tentativa RUNNING não pode possuir motivo de falha.',
        });
      }
      if (
        attempt.activePhase === 'EXECUTING' &&
        (attempt.heartbeatAt === null ||
          attempt.leaseExpiresAt === null ||
          attempt.completionRecordedAt !== null ||
          attempt.recoveryReasonCode !== null)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['activePhase'],
          message: 'EXECUTING exige lease observável e não aceita journal ou recovery.',
        });
      }
      if (
        attempt.activePhase === 'COMPLETION_PENDING' &&
        (attempt.completionRecordedAt === null || attempt.recoveryReasonCode !== null)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['completionRecordedAt'],
          message: 'COMPLETION_PENDING exige journal durável.',
        });
      }
      if (attempt.activePhase === 'RECOVERY_REQUIRED' && attempt.recoveryReasonCode === null) {
        context.addIssue({
          code: 'custom',
          path: ['recoveryReasonCode'],
          message: 'RECOVERY_REQUIRED exige motivo seguro.',
        });
      }
      return;
    }

    if (attempt.activePhase !== null || attempt.recoveryReasonCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['activePhase'],
        message: 'Uma tentativa terminal não pode manter fase ativa ou recovery.',
      });
    }

    if (attempt.status === 'SUCCESS') {
      if (attempt.result === null) {
        context.addIssue({
          code: 'custom',
          path: ['result'],
          message: 'Uma tentativa SUCCESS exige resultado terminal.',
        });
      }
      if (attempt.failureReasonCode !== null) {
        context.addIssue({
          code: 'custom',
          path: ['failureReasonCode'],
          message: 'Uma tentativa SUCCESS não pode possuir motivo de falha.',
        });
      }
      return;
    }

    if (attempt.failureReasonCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['failureReasonCode'],
        message: 'Uma tentativa FAILED ou CANCELLED exige motivo de falha.',
      });
    }
    if (attempt.status === 'CANCELLED' && attempt.result === null) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Uma tentativa CANCELLED exige resultado terminal.',
      });
    }
    if (
      attempt.result !== null &&
      attempt.result.failure?.reasonCode !== attempt.failureReasonCode
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failureReasonCode'],
        message: 'O motivo persistido deve corresponder ao resultado terminal.',
      });
    }
    if (
      attempt.result === null &&
      attempt.failureReasonCode !== null &&
      attempt.cleanupConfirmed !== isTechnicalResumePrePhysicalFailure(attempt.failureReasonCode)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cleanupConfirmed'],
        message: 'Cleanup sem resultado só pode ser confirmado para falha pré-física.',
      });
    }
  });

export const factoryTechnicalResumeReconciliationSchema = z
  .object({
    outcome: factoryTechnicalResumeReconciliationOutcomeSchema,
    attempt: factoryTechnicalResumeAttemptRecordSchema.nullable(),
  })
  .strict()
  .superRefine((reconciliation, context) => {
    if ((reconciliation.outcome === 'NONE') !== (reconciliation.attempt === null)) {
      context.addIssue({
        code: 'custom',
        path: ['attempt'],
        message: 'Somente NONE pode omitir a tentativa reconciliada.',
      });
    }
    if (reconciliation.outcome === 'FINALIZED' && reconciliation.attempt?.status === 'RUNNING') {
      context.addIssue({
        code: 'custom',
        path: ['attempt', 'status'],
        message: 'FINALIZED exige tentativa terminal.',
      });
    }
    if (
      reconciliation.outcome === 'ACTIVE' &&
      reconciliation.attempt?.activePhase !== 'EXECUTING'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['attempt', 'activePhase'],
        message: 'ACTIVE exige fase EXECUTING.',
      });
    }
    if (
      reconciliation.outcome === 'RECOVERY_REQUIRED' &&
      reconciliation.attempt?.activePhase !== 'RECOVERY_REQUIRED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['attempt', 'activePhase'],
        message: 'RECOVERY_REQUIRED exige fase correlacionada.',
      });
    }
  });

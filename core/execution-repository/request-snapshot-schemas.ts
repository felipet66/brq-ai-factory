import { deriveExecutionIdentity, executionRequestSchema } from '@brq/execution-engine';
import { isoDateTimeSchema } from '@brq/shared/schemas/common.schema';
import { z } from 'zod';

export const EXECUTION_REQUEST_SNAPSHOT_VERSION = '1.0.0' as const;

export const executionRequestSnapshotOwnerIdSchema = z.string().trim().min(1).max(128);
export const executionRequestSnapshotReplayModeSchema = z.literal('REQUIRE_CACHE_HIT');

const executionRequestSnapshotExecutionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/);

const executionRequestSnapshotReplayFields = {
  replaySourceExecutionId: executionRequestSnapshotExecutionIdSchema.nullable(),
  replayCacheExecutionId: executionRequestSnapshotExecutionIdSchema.nullable(),
  replayMode: executionRequestSnapshotReplayModeSchema.nullable(),
} as const;

function validateReplayProvenance(
  snapshot: {
    readonly executionId?: string;
    readonly replaySourceExecutionId: string | null;
    readonly replayCacheExecutionId: string | null;
    readonly replayMode: 'REQUIRE_CACHE_HIT' | null;
  },
  context: z.RefinementCtx,
): void {
  const replayFields = [
    snapshot.replaySourceExecutionId,
    snapshot.replayCacheExecutionId,
    snapshot.replayMode,
  ];
  const populatedFields = replayFields.filter((value) => value !== null).length;
  if (populatedFields !== 0 && populatedFields !== replayFields.length) {
    context.addIssue({
      code: 'custom',
      path: ['replayMode'],
      message: 'A proveniência de replay deve ser integralmente nula ou integralmente preenchida.',
    });
  }

  if (
    snapshot.executionId !== undefined &&
    (snapshot.replaySourceExecutionId === snapshot.executionId ||
      snapshot.replayCacheExecutionId === snapshot.executionId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['replaySourceExecutionId'],
      message: 'Uma execução de replay não pode apontar para si própria.',
    });
  }
}

export const executionRequestSnapshotSchema = z
  .object({
    version: z.literal(EXECUTION_REQUEST_SNAPSHOT_VERSION),
    ownerId: executionRequestSnapshotOwnerIdSchema,
    executionId: executionRequestSnapshotExecutionIdSchema,
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    request: executionRequestSchema,
    ...executionRequestSnapshotReplayFields,
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    validateReplayProvenance(snapshot, context);
    const identity = deriveExecutionIdentity(snapshot.request);
    if (snapshot.executionId !== identity.executionId) {
      context.addIssue({
        code: 'custom',
        path: ['executionId'],
        message: 'O snapshot deve pertencer deterministicamente ao ExecutionRequest informado.',
      });
    }
    if (snapshot.requestHash !== identity.executionRequestHash) {
      context.addIssue({
        code: 'custom',
        path: ['requestHash'],
        message: 'O hash do snapshot deve corresponder ao ExecutionRequest informado.',
      });
    }
  });

export const executionRequestSnapshotSaveInputSchema = z
  .object({
    ownerId: executionRequestSnapshotOwnerIdSchema,
    request: executionRequestSchema,
    ...executionRequestSnapshotReplayFields,
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine(validateReplayProvenance);

export const executionRequestSnapshotLookupSchema = z
  .object({
    ownerId: executionRequestSnapshotOwnerIdSchema,
    executionId: executionRequestSnapshotExecutionIdSchema,
  })
  .strict();

import { deriveExecutionIdentity } from '@brq/execution-engine';

import type {
  ExecutionRequestSnapshot,
  ExecutionRequestSnapshotLookup,
  ExecutionRequestSnapshotRepository,
  ExecutionRequestSnapshotSaveInput,
} from '../request-snapshot-contracts';
import {
  EXECUTION_REQUEST_SNAPSHOT_VERSION,
  executionRequestSnapshotLookupSchema,
  executionRequestSnapshotSaveInputSchema,
  executionRequestSnapshotSchema,
} from '../request-snapshot-schemas';
import { EXECUTION_REPOSITORY_ERROR_CODES, ExecutionRepositoryError } from '../errors';
import { immutableClone } from '../immutability';
import { executionRequestSnapshotsHaveEqualImmutableContent } from '../request-snapshot-equality';

function invalidInput(message: string, cause?: unknown): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function createInMemoryExecutionRequestSnapshotRepository(): ExecutionRequestSnapshotRepository {
  const snapshots = new Map<string, ExecutionRequestSnapshot>();

  return Object.freeze({
    async save(rawInput: ExecutionRequestSnapshotSaveInput): Promise<ExecutionRequestSnapshot> {
      const parsed = executionRequestSnapshotSaveInputSchema.safeParse(rawInput);
      if (!parsed.success) throw invalidInput('Entrada de snapshot inválida.', parsed.error);

      const identity = deriveExecutionIdentity(parsed.data.request);
      const snapshot = executionRequestSnapshotSchema.parse({
        version: EXECUTION_REQUEST_SNAPSHOT_VERSION,
        ownerId: parsed.data.ownerId,
        executionId: identity.executionId,
        requestHash: identity.executionRequestHash,
        request: parsed.data.request,
        replaySourceExecutionId: parsed.data.replaySourceExecutionId,
        replayCacheExecutionId: parsed.data.replayCacheExecutionId,
        replayMode: parsed.data.replayMode,
        createdAt: parsed.data.createdAt,
      });
      const previous = snapshots.get(snapshot.executionId);
      if (previous !== undefined) {
        if (executionRequestSnapshotsHaveEqualImmutableContent(previous, snapshot)) {
          return immutableClone(previous);
        }
        throw new ExecutionRepositoryError('O snapshot da execução já existe e é imutável.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }

      const immutable = immutableClone(snapshot);
      snapshots.set(snapshot.executionId, immutable);
      return immutableClone(immutable);
    },

    async findOwned(
      rawInput: ExecutionRequestSnapshotLookup,
    ): Promise<ExecutionRequestSnapshot | null> {
      const parsed = executionRequestSnapshotLookupSchema.safeParse(rawInput);
      if (!parsed.success) throw invalidInput('Consulta de snapshot inválida.', parsed.error);
      const snapshot = snapshots.get(parsed.data.executionId);
      return snapshot === undefined || snapshot.ownerId !== parsed.data.ownerId
        ? null
        : immutableClone(snapshot);
    },
  });
}

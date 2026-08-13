import { deriveExecutionIdentity } from '@brq/execution-engine';
import { Prisma, type DatabaseClient } from '@brq/prisma/client';

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

const OWNER_ID_MAX_LENGTH = 128;

function invalidInput(message: string, cause?: unknown): ExecutionRepositoryError {
  return new ExecutionRepositoryError(message, {
    code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_INPUT,
    ...(cause === undefined ? {} : { cause }),
  });
}

function parseOwnerId(ownerId: string): string {
  if (
    typeof ownerId !== 'string' ||
    ownerId.trim() !== ownerId ||
    ownerId.length === 0 ||
    ownerId.length > OWNER_ID_MAX_LENGTH
  ) {
    throw new ExecutionRepositoryError('Owner do snapshot de execução inválido.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  return ownerId;
}

function persistenceError(error: unknown): never {
  if (error instanceof ExecutionRepositoryError) throw error;
  const code =
    error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  if (code === 'P2002' || code === 'P2003') {
    throw new ExecutionRepositoryError('Conflito ao persistir o snapshot de execução.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
      cause: error,
    });
  }
  throw new ExecutionRepositoryError('Falha ao persistir o snapshot de execução.', {
    code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
    cause: error,
  });
}

function projectSnapshot(raw: {
  readonly executionId: string;
  readonly ownerId: string;
  readonly requestHash: string;
  readonly version: string;
  readonly request: unknown;
  readonly replaySourceExecutionId: string | null;
  readonly replayCacheExecutionId: string | null;
  readonly replayMode: string | null;
  readonly createdAt: Date;
}): ExecutionRequestSnapshot {
  const parsed = executionRequestSnapshotSchema.safeParse({
    ...raw,
    createdAt: raw.createdAt.toISOString(),
  });
  if (!parsed.success) {
    throw new ExecutionRepositoryError('Snapshot de execução persistido inválido.', {
      code: EXECUTION_REPOSITORY_ERROR_CODES.PERSISTENCE_FAILED,
      cause: parsed.error,
    });
  }
  return immutableClone(parsed.data);
}

/** Prisma adapter bound to one authenticated owner. */
export class PrismaExecutionRequestSnapshotRepository implements ExecutionRequestSnapshotRepository {
  private readonly ownerId: string;

  constructor(
    private readonly client: DatabaseClient,
    ownerId: string,
  ) {
    this.ownerId = parseOwnerId(ownerId);
  }

  private assertOwner(ownerId: string): void {
    if (ownerId !== this.ownerId) {
      throw invalidInput('O snapshot deve pertencer ao owner autenticado.');
    }
  }

  async save(rawInput: ExecutionRequestSnapshotSaveInput): Promise<ExecutionRequestSnapshot> {
    const parsed = executionRequestSnapshotSaveInputSchema.safeParse(rawInput);
    if (!parsed.success) throw invalidInput('Entrada de snapshot inválida.', parsed.error);
    this.assertOwner(parsed.data.ownerId);

    const identity = deriveExecutionIdentity(parsed.data.request);
    const candidate = executionRequestSnapshotSchema.parse({
      version: EXECUTION_REQUEST_SNAPSHOT_VERSION,
      ownerId: this.ownerId,
      executionId: identity.executionId,
      requestHash: identity.executionRequestHash,
      request: parsed.data.request,
      replaySourceExecutionId: parsed.data.replaySourceExecutionId,
      replayCacheExecutionId: parsed.data.replayCacheExecutionId,
      replayMode: parsed.data.replayMode,
      createdAt: parsed.data.createdAt,
    });

    try {
      const record = await this.client.executionRequestSnapshot.upsert({
        where: { executionId: candidate.executionId },
        create: {
          executionId: candidate.executionId,
          ownerId: candidate.ownerId,
          requestHash: candidate.requestHash,
          version: candidate.version,
          request: structuredClone(candidate.request) as Prisma.InputJsonValue,
          replaySourceExecutionId: candidate.replaySourceExecutionId,
          replayCacheExecutionId: candidate.replayCacheExecutionId,
          replayMode: candidate.replayMode,
          createdAt: new Date(candidate.createdAt),
        },
        update: {},
      });
      const stored = projectSnapshot(record);
      if (!executionRequestSnapshotsHaveEqualImmutableContent(stored, candidate)) {
        throw new ExecutionRepositoryError('O snapshot da execução já existe e é imutável.', {
          code: EXECUTION_REPOSITORY_ERROR_CODES.CONFLICT,
        });
      }
      return stored;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async findOwned(
    rawInput: ExecutionRequestSnapshotLookup,
  ): Promise<ExecutionRequestSnapshot | null> {
    const parsed = executionRequestSnapshotLookupSchema.safeParse(rawInput);
    if (!parsed.success) throw invalidInput('Consulta de snapshot inválida.', parsed.error);
    this.assertOwner(parsed.data.ownerId);

    try {
      const record = await this.client.executionRequestSnapshot.findFirst({
        where: { executionId: parsed.data.executionId, ownerId: this.ownerId },
      });
      return record === null ? null : projectSnapshot(record);
    } catch (error) {
      return persistenceError(error);
    }
  }
}

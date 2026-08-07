import { executionResultSchema, type ExecutionResult } from '@brq/execution-engine';
import {
  executionObservabilitySnapshotSchema,
  type ExecutionObservabilitySnapshot,
} from '@brq/observability';

import type {
  ExecutionRecord,
  ExecutionRecordCreatedInput,
  ExecutionRecordLifecycleEvent,
} from './contracts';
import { immutableClone } from './immutability';
import {
  executionRecordCreatedInputSchema,
  executionRecordSchema,
  persistedLineageSchema,
  persistedProvenanceSchema,
} from './schemas';

const EMPTY_HASHES = Object.freeze({
  executionRequestHash: null,
  workflowRequestHash: null,
  workflowHash: null,
  lineageHash: null,
  provenanceHash: null,
  executionHash: null,
});

export function createExecutionRecord(
  storageId: string,
  input: ExecutionRecordCreatedInput,
): ExecutionRecord {
  const validInput = executionRecordCreatedInputSchema.parse(input);
  return immutableClone(
    executionRecordSchema.parse({
      storageId,
      ...validInput,
      executionId: null,
      status: 'CREATED',
      workflowStatus: null,
      readiness: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      hashes: EMPTY_HASHES,
      failure: null,
      lineage: null,
      provenance: null,
      observation: null,
      lifecycle: [
        {
          sequence: 1,
          event: 'EXECUTION_CREATED',
          state: 'CREATED',
          occurredAt: validInput.createdAt,
          durationMs: null,
        },
      ],
      revision: 0,
    }),
  );
}

export function projectRunningExecutionRecord(
  record: ExecutionRecord,
  startedAt: string,
): ExecutionRecord {
  const lifecycle: ExecutionRecordLifecycleEvent[] = [
    ...record.lifecycle,
    {
      sequence: record.lifecycle.length + 1,
      event: 'EXECUTION_RUNNING',
      state: 'RUNNING',
      occurredAt: startedAt,
      durationMs: null,
    },
  ];
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      status: 'RUNNING',
      startedAt,
      lifecycle,
      revision: record.revision + 1,
    }),
  );
}

export function projectObservedExecutionRecord(
  record: ExecutionRecord,
  rawSnapshot: ExecutionObservabilitySnapshot,
): ExecutionRecord {
  const snapshot = executionObservabilitySnapshotSchema.parse(rawSnapshot);
  if (snapshot.workflowId !== record.workflowId) {
    throw new TypeError('A observação não corresponde ao workflow persistido.');
  }
  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      executionId: snapshot.executionId,
      observation: snapshot,
      revision: record.revision + 1,
    }),
  );
}

function terminalLifecycleEvent(
  result: ExecutionResult,
  sequence: number,
): ExecutionRecordLifecycleEvent {
  return {
    sequence,
    event:
      result.status === 'SUCCESS'
        ? 'EXECUTION_FINISHED'
        : result.status === 'FAILED'
          ? 'EXECUTION_FAILED'
          : 'EXECUTION_CANCELLED',
    state: result.status,
    occurredAt: result.finishedAt,
    durationMs: result.metrics.observed.totalDurationMs,
  };
}

export function projectTerminalExecutionRecord(
  record: ExecutionRecord,
  rawResult: ExecutionResult,
  rawSnapshot: ExecutionObservabilitySnapshot | null,
): ExecutionRecord {
  const result = executionResultSchema.parse(rawResult);
  const snapshot =
    rawSnapshot === null ? null : executionObservabilitySnapshotSchema.parse(rawSnapshot);
  if (
    result.workflowId !== record.workflowId ||
    (snapshot !== null &&
      (snapshot.workflowId !== record.workflowId || snapshot.executionId !== result.executionId))
  ) {
    throw new TypeError('O resultado terminal não corresponde ao registro persistido.');
  }

  return immutableClone(
    executionRecordSchema.parse({
      ...record,
      executionId: result.executionId,
      status: result.status,
      workflowStatus: result.workflowResult?.status ?? result.status,
      readiness: snapshot?.summary?.readinessFinal ?? null,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.metrics.observed.totalDurationMs,
      metadata: result.metadata,
      hashes: result.hashes,
      failure:
        result.failure === null
          ? null
          : {
              kind: result.failure.kind,
              code: result.failure.code,
              sourceCode: result.failure.sourceCode,
            },
      lineage: result.lineage === null ? null : persistedLineageSchema.parse(result.lineage),
      provenance:
        result.provenance === null ? null : persistedProvenanceSchema.parse(result.provenance),
      observation: snapshot,
      lifecycle: [...record.lifecycle, terminalLifecycleEvent(result, record.lifecycle.length + 1)],
      revision: record.revision + 1,
    }),
  );
}

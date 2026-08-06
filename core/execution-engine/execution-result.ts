import type { WorkflowResult } from '@brq/orchestrator';

import type {
  ExecutionFailure,
  ExecutionMetadata,
  ExecutionResult,
  ExecutionTimelineEvent,
} from './contracts';
import { calculateCanonicalJsonHash } from './hashing';
import { deepFreeze } from './immutability';
import { executionResultSchema } from './schemas';

export interface CreateExecutionResultInput {
  readonly executionId: string;
  readonly workflowId: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  readonly startedAt: string | null;
  readonly finishedAt: string;
  readonly metadata: ExecutionMetadata;
  readonly workflowResult: WorkflowResult | null;
  readonly timeline: readonly ExecutionTimelineEvent[];
  readonly totalDurationMs: number;
  readonly orchestratorInvocations: number;
  readonly executionRequestHash: string;
  readonly workflowRequestHash: string;
  readonly failure: ExecutionFailure | null;
}

export function createExecutionResult(input: CreateExecutionResultInput): ExecutionResult {
  const workflow = input.workflowResult;
  const lineage = workflow?.lineage ?? null;
  const provenance = workflow?.provenance ?? null;
  const workflowHash = workflow?.hashes.workflowHash ?? null;
  const lineageHash = workflow?.hashes.lineageHash ?? null;
  const provenanceHash = workflow?.hashes.provenanceHash ?? null;
  const executionHash = calculateCanonicalJsonHash({
    engineVersion: input.metadata.engineVersion,
    contractVersion: input.metadata.contractVersion,
    executionId: input.executionId,
    workflowId: input.workflowId,
    attempt: input.metadata.attempt,
    status: input.status,
    executionRequestHash: input.executionRequestHash,
    workflowRequestHash: input.workflowRequestHash,
    workflowHash,
    lineageHash,
    provenanceHash,
    failureCode: input.failure?.code ?? null,
    sourceCode: input.failure?.sourceCode ?? null,
  });
  const result = executionResultSchema.parse({
    executionId: input.executionId,
    workflowId: input.workflowId,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    metadata: input.metadata,
    workflowResult: workflow,
    timeline: input.timeline,
    lineage,
    provenance,
    metrics: {
      observed: {
        totalDurationMs: input.totalDurationMs,
        orchestratorInvocations: input.orchestratorInvocations,
      },
      workflow: workflow?.metrics ?? null,
    },
    hashes: {
      executionRequestHash: input.executionRequestHash,
      workflowRequestHash: input.workflowRequestHash,
      workflowHash,
      lineageHash,
      provenanceHash,
      executionHash,
    },
    failure: input.failure,
  });
  return deepFreeze(result);
}

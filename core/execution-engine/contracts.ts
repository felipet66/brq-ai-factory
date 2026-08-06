import type {
  Orchestrator,
  WorkflowLineage,
  WorkflowMetrics,
  WorkflowProvenance,
  WorkflowRequest,
  WorkflowResult,
} from '@brq/orchestrator';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  executionFailureSchema,
  executionHashesSchema,
  executionMetadataSchema,
  executionMetricsSchema,
  executionRequestSchema,
  executionResultSchema,
  executionStateSchema,
  executionTimelineEventSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ExecutionRequest = DeepReadonly<z.infer<typeof executionRequestSchema>>;
export type ExecutionState = DeepReadonly<z.infer<typeof executionStateSchema>>;
export type ExecutionTimelineEvent = DeepReadonly<z.infer<typeof executionTimelineEventSchema>>;
export type ExecutionMetadata = DeepReadonly<z.infer<typeof executionMetadataSchema>>;
export type ExecutionMetrics = DeepReadonly<z.infer<typeof executionMetricsSchema>>;
export type ExecutionHashes = DeepReadonly<z.infer<typeof executionHashesSchema>>;
export type ExecutionFailure = DeepReadonly<z.infer<typeof executionFailureSchema>>;
export type ExecutionResult = DeepReadonly<z.infer<typeof executionResultSchema>>;

export interface ExecutionOptions {
  readonly signal?: AbortSignal;
}

export interface CreateExecutionEngineOptions {
  readonly orchestrator: Orchestrator;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface ExecutionEngine {
  execute(request: ExecutionRequest, options?: ExecutionOptions): Promise<ExecutionResult>;
}

export interface ExecutionWorkflowSnapshot {
  readonly request: WorkflowRequest;
  readonly result: WorkflowResult | null;
  readonly lineage: WorkflowLineage | null;
  readonly provenance: WorkflowProvenance | null;
  readonly metrics: WorkflowMetrics | null;
}

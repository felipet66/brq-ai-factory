import type { ExecutionEngine, ExecutionRequest, ExecutionResult } from '@brq/execution-engine';
import type {
  FactoryExecutionResult,
  FactoryPipelineCoordinator,
  FactoryPipelineRunOptions,
} from '@brq/factory-pipeline';
import type {
  FactoryExecutionHistoryRecorder,
  FactoryExecutionObservabilitySnapshot,
  ExecutionHistoryReader,
  ExecutionHistoryRecorder,
  ExecutionObservabilitySnapshot,
  FactoryExecutionHistoryReader,
} from '@brq/observability';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  executionRecordCreatedInputSchema,
  executionRecordLifecycleEventSchema,
  executionRecordJobRunningInputSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordListQuerySchema,
  executionRecordPageSchema,
  executionRecordQueuedInputSchema,
  executionRecordRunningInputSchema,
  executionRecordSchema,
  executionRecordStatusSchema,
  persistedFactoryLineageSchema,
  persistedFactoryProvenanceSchema,
  persistedFactoryResultSchema,
  persistedFactoryStageSchema,
  persistedLineageSchema,
  persistedProvenanceSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ExecutionRecordStatus = z.infer<typeof executionRecordStatusSchema>;
export type ExecutionRecordLifecycleEvent = DeepReadonly<
  z.infer<typeof executionRecordLifecycleEventSchema>
>;
export type PersistedLineage = DeepReadonly<z.infer<typeof persistedLineageSchema>>;
export type PersistedProvenance = DeepReadonly<z.infer<typeof persistedProvenanceSchema>>;
export type PersistedFactoryStage = DeepReadonly<z.infer<typeof persistedFactoryStageSchema>>;
export type PersistedFactoryLineage = DeepReadonly<z.infer<typeof persistedFactoryLineageSchema>>;
export type PersistedFactoryProvenance = DeepReadonly<
  z.infer<typeof persistedFactoryProvenanceSchema>
>;
export type PersistedFactoryResult = DeepReadonly<z.infer<typeof persistedFactoryResultSchema>>;
export type ExecutionRecord = DeepReadonly<z.infer<typeof executionRecordSchema>>;
export type ExecutionRecordCreatedInput = DeepReadonly<
  z.input<typeof executionRecordCreatedInputSchema>
>;
export type ExecutionRecordRunningInput = DeepReadonly<
  z.infer<typeof executionRecordRunningInputSchema>
>;
export type ExecutionRecordQueuedInput = DeepReadonly<
  z.infer<typeof executionRecordQueuedInputSchema>
>;
export type ExecutionRecordJobRunningInput = DeepReadonly<
  z.infer<typeof executionRecordJobRunningInputSchema>
>;
export type ExecutionRecordJobTerminalInput = DeepReadonly<
  z.infer<typeof executionRecordJobTerminalInputSchema>
>;
export type ExecutionRecordListQuery = DeepReadonly<z.input<typeof executionRecordListQuerySchema>>;
export type ExecutionRecordPage = DeepReadonly<z.infer<typeof executionRecordPageSchema>>;

export interface ExecutionRecordRepository {
  create(input: ExecutionRecordCreatedInput): Promise<ExecutionRecord>;
  createQueued(input: ExecutionRecordQueuedInput): Promise<ExecutionRecord>;
  markJobRunning(input: ExecutionRecordJobRunningInput): Promise<ExecutionRecord>;
  markJobTerminal(input: ExecutionRecordJobTerminalInput): Promise<ExecutionRecord>;
  markRunning(input: ExecutionRecordRunningInput): Promise<ExecutionRecord>;
  saveObservation(
    workflowId: string,
    snapshot: ExecutionObservabilitySnapshot,
  ): Promise<ExecutionRecord>;
  complete(
    workflowId: string,
    result: ExecutionResult,
    snapshot: ExecutionObservabilitySnapshot | null,
  ): Promise<ExecutionRecord>;
  findByExecutionId(executionId: string): Promise<ExecutionRecord | null>;
  findByJobId(jobId: string): Promise<ExecutionRecord | null>;
  findByWorkflowId(workflowId: string): Promise<ExecutionRecord | null>;
  list(query?: ExecutionRecordListQuery): Promise<ExecutionRecordPage>;
}

export interface FactoryExecutionRecordRepository extends ExecutionRecordRepository {
  completeFactory(
    workflowId: string,
    result: FactoryExecutionResult,
    snapshot: FactoryExecutionObservabilitySnapshot | null,
  ): Promise<ExecutionRecord>;
}

export interface PersistentExecutionHistory extends ExecutionHistoryRecorder {
  flush(workflowId: string): Promise<void>;
}

export interface PersistentFactoryExecutionHistory extends FactoryExecutionHistoryRecorder {
  flush(workflowId: string): Promise<void>;
}

export interface CreateRepositoryBackedExecutionHistoryOptions {
  readonly history: ExecutionHistoryRecorder;
  readonly repository: ExecutionRecordRepository;
  readonly logger?: Logger;
}

export interface CreatePersistentExecutionEngineOptions {
  readonly engine: ExecutionEngine;
  readonly repository: ExecutionRecordRepository;
  readonly history: PersistentExecutionHistory & ExecutionHistoryReader;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface CreatePersistentFactoryPipelineOptions {
  readonly pipeline: FactoryPipelineCoordinator;
  readonly repository: FactoryExecutionRecordRepository;
  readonly history: PersistentFactoryExecutionHistory & FactoryExecutionHistoryReader;
  readonly logger?: Logger;
  readonly now?: () => number;
}

export interface PersistentFactoryPipeline {
  execute(
    request: ExecutionRequest,
    options?: FactoryPipelineRunOptions,
  ): Promise<FactoryExecutionResult>;
}

export interface ExecutionRecordProjection {
  readonly request: ExecutionRequest;
  readonly result: ExecutionResult;
  readonly snapshot: ExecutionObservabilitySnapshot | null;
}

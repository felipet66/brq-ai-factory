import type { ExecutionEngine, ExecutionRequest, ExecutionResult } from '@brq/execution-engine';
import type { FactoryExecutionResult, FactoryPipelineCoordinator } from '@brq/factory-pipeline';
import type { Logger, LogLevel } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  executionCostEstimateSchema,
  executionObservabilityEventSchema,
  executionObservabilitySnapshotSchema,
  executionObservabilitySummarySchema,
  executionStageMetricsSchema,
  executionStageSchema,
  executionTimelineStageIdSchema,
  factoryExecutionObservabilityEventSchema,
  factoryExecutionObservabilitySnapshotSchema,
  factoryExecutionObservabilitySummarySchema,
  factoryExecutionStageMetricsSchema,
  factoryExecutionStageSchema,
  factoryExecutionTimelineStageIdSchema,
  factoryObservableAgentStageIdSchema,
  factoryObservabilityStageIdSchema,
  observableAgentStageIdSchema,
  observabilityEventTypeSchema,
  observabilityStageIdSchema,
  observabilityStatusSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type ObservabilityEventType = z.infer<typeof observabilityEventTypeSchema>;
export type ObservabilityStageId = z.infer<typeof observabilityStageIdSchema>;
export type ObservableAgentStageId = z.infer<typeof observableAgentStageIdSchema>;
export type ObservabilityStatus = z.infer<typeof observabilityStatusSchema>;
export type ExecutionObservabilityEvent = DeepReadonly<
  z.infer<typeof executionObservabilityEventSchema>
>;
export type ExecutionStage = DeepReadonly<z.infer<typeof executionStageSchema>>;
export type ExecutionTimelineStageId = z.infer<typeof executionTimelineStageIdSchema>;
export type ExecutionStageMetrics = DeepReadonly<z.infer<typeof executionStageMetricsSchema>>;
export type ExecutionCostEstimate = DeepReadonly<z.infer<typeof executionCostEstimateSchema>>;
export type ExecutionObservabilitySummary = DeepReadonly<
  z.infer<typeof executionObservabilitySummarySchema>
>;
export type ExecutionObservabilitySnapshot = DeepReadonly<
  z.infer<typeof executionObservabilitySnapshotSchema>
>;
export type FactoryExecutionTimelineStageId = z.infer<typeof factoryExecutionTimelineStageIdSchema>;
export type FactoryObservableAgentStageId = z.infer<typeof factoryObservableAgentStageIdSchema>;
export type FactoryObservabilityStageId = z.infer<typeof factoryObservabilityStageIdSchema>;
export type FactoryExecutionObservabilityEvent = DeepReadonly<
  z.infer<typeof factoryExecutionObservabilityEventSchema>
>;
export type FactoryExecutionStage = DeepReadonly<z.infer<typeof factoryExecutionStageSchema>>;
export type FactoryExecutionStageMetrics = DeepReadonly<
  z.infer<typeof factoryExecutionStageMetricsSchema>
>;
export type FactoryExecutionObservabilitySummary = DeepReadonly<
  z.infer<typeof factoryExecutionObservabilitySummarySchema>
>;
export type FactoryExecutionObservabilitySnapshot = DeepReadonly<
  z.infer<typeof factoryExecutionObservabilitySnapshotSchema>
>;

export interface ExecutionHistoryReader {
  get(id: string): ExecutionObservabilitySnapshot | null;
}

export interface ObservabilityEventRecorder {
  capture(level: LogLevel, event: string, context: Readonly<Record<string, unknown>>): void;
}

export interface ExecutionHistoryRecorder
  extends ExecutionHistoryReader, ObservabilityEventRecorder {
  begin(request: ExecutionRequest): void;
  complete(result: ExecutionResult): void;
}

export interface FactoryExecutionHistoryReader {
  get(id: string): FactoryExecutionObservabilitySnapshot | null;
}

export interface FactoryExecutionHistoryRecorder
  extends FactoryExecutionHistoryReader, ObservabilityEventRecorder {
  beginFactory(request: ExecutionRequest): void;
  completeFactory(result: FactoryExecutionResult): void;
}

export interface CreateInMemoryExecutionHistoryOptions {
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface CreateObservabilityLoggerOptions {
  readonly delegate: Logger;
  readonly history: ObservabilityEventRecorder;
}

export interface CreateObservedExecutionEngineOptions {
  readonly engine: ExecutionEngine;
  readonly history: ExecutionHistoryRecorder;
}

export interface CreateObservedFactoryPipelineOptions {
  readonly pipeline: FactoryPipelineCoordinator;
  readonly history: FactoryExecutionHistoryRecorder;
}

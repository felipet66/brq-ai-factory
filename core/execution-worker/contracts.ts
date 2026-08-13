import type { ExecutionEngine, ExecutionRequest } from '@brq/execution-engine';
import type {
  ExecutionRecordRepository,
  ExecutionRequestSnapshotRepository,
  FactoryTechnicalCheckpointRepository,
} from '@brq/execution-repository';
import type {
  FactoryPipelineCoordinator,
  FactoryTechnicalResumeExecutor,
} from '@brq/factory-pipeline';
import type { JobExecutionOptions, JobQueue, JobRecord } from '@brq/job-queue';
import type { Logger } from '@brq/shared/logger/logger';

export interface ExecutionDispatcher {
  dispatch(request: ExecutionRequest): Promise<JobRecord>;
}

export interface ExecutionDispatcherWithOptions extends ExecutionDispatcher {
  dispatchWithOptions(
    request: ExecutionRequest,
    executionOptions: JobExecutionOptions,
  ): Promise<JobRecord>;
}

export interface SnapshottingExecutionDispatcherOptions {
  readonly dispatcher: ExecutionDispatcher;
  readonly snapshots: ExecutionRequestSnapshotRepository;
  readonly ownerId: string;
  readonly now?: () => number;
}

export interface CacheOnlyExecutionDispatchContext {
  readonly mode: 'REQUIRE_CACHE_HIT';
  readonly sourceExecutionId: string;
}

/**
 * Dedicated host port for reruns. Implementations must fail on a cache miss and must never fall
 * back to a live AI provider.
 */
export interface CacheOnlyExecutionDispatcher {
  dispatchCacheOnly(
    request: ExecutionRequest,
    context: CacheOnlyExecutionDispatchContext,
  ): Promise<JobRecord>;
}

export interface ExecutionRerunDispatchInput {
  readonly ownerId: string;
  readonly sourceExecutionId: string;
  readonly requestId: string;
}

export interface ExecutionRerunAccepted {
  readonly sourceExecutionId: string;
  readonly executionId: string;
  readonly jobId: string;
  readonly status: 'QUEUED';
  readonly usesOpenAI: false;
}

export interface ExecutionRerunDispatcher {
  dispatch(input: ExecutionRerunDispatchInput): Promise<ExecutionRerunAccepted>;
}

export type ReplayCheckpointAgent = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA' | 'CODE_GENERATOR';

export interface ReplayCheckpointInspection {
  readonly executionId: string;
  readonly complete: boolean;
  readonly missingAgents: readonly ReplayCheckpointAgent[];
  readonly checkpoints: readonly {
    readonly agent: ReplayCheckpointAgent;
    readonly provider: string;
    readonly requestHash: string;
    readonly responseHash: string;
  }[];
}

/** Worker-owned read-only port; the application host may adapt any checkpoint persistence. */
export interface ReplayCheckpointReader {
  inspectExecution(input: {
    readonly executionId: string;
    readonly requiredAgents: readonly ReplayCheckpointAgent[];
  }): Promise<ReplayCheckpointInspection>;
}

export interface ReplaySourceEligibility {
  readonly executionId: string;
  readonly terminal: boolean;
  readonly codeGeneratorSucceeded: boolean;
}

/** Owner-scoped projection of the persisted source lifecycle used as a second trust boundary. */
export interface ReplaySourceEligibilityReader {
  inspectExecution(executionId: string): Promise<ReplaySourceEligibility | null>;
}

export interface CreateExecutionRerunDispatcherOptions {
  readonly snapshots: ExecutionRequestSnapshotRepository;
  readonly sourceEligibility: ReplaySourceEligibilityReader;
  readonly checkpoints: ReplayCheckpointReader;
  readonly cacheOnlyDispatcher: CacheOnlyExecutionDispatcher;
  readonly idFactory?: () => string;
  readonly now?: () => number;
}

export interface TechnicalResumeDispatchInput {
  readonly ownerId: string;
  readonly sourceExecutionId: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

export interface TechnicalResumeDispatchResult {
  readonly attemptId: string;
  readonly sourceExecutionId: string;
  readonly checkpointHash: string;
  readonly status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'COMPLETION_PENDING';
  readonly resultHash: string;
  readonly usesOpenAI: false;
}

export interface TechnicalResumeDispatcher {
  dispatch(input: TechnicalResumeDispatchInput): Promise<TechnicalResumeDispatchResult>;
}

export interface CreateTechnicalResumeDispatcherOptions {
  readonly repository: FactoryTechnicalCheckpointRepository;
  readonly executor: FactoryTechnicalResumeExecutor;
  readonly idFactory?: () => string;
  readonly now?: () => number;
  readonly leaseDurationMs?: number;
  readonly heartbeatIntervalMs?: number;
}

export interface ExecutionWorker {
  start(): void;
  drain(): Promise<void>;
  cancel(jobId: string): Promise<JobRecord | null>;
  shutdown(): Promise<void>;
  isStarted(): boolean;
}

export interface CreateExecutionDispatcherOptions {
  readonly queue: JobQueue;
  readonly repository: ExecutionRecordRepository;
  readonly logger?: Logger;
  readonly now?: () => number;
}

interface CreateExecutionWorkerBaseOptions {
  readonly queue: JobQueue;
  readonly repository: ExecutionRecordRepository;
  readonly logger?: Logger;
}

export type CreateExecutionWorkerOptions = CreateExecutionWorkerBaseOptions &
  (
    | {
        /** Compatibility path for execution-only hosts. */
        readonly engine: ExecutionEngine;
        readonly pipeline?: never;
      }
    | {
        /** Full Factory lifecycle used by the AI Factory application host. */
        readonly pipeline: FactoryPipelineCoordinator;
        readonly engine?: never;
      }
  );

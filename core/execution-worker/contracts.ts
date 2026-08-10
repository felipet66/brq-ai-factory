import type { ExecutionEngine, ExecutionRequest } from '@brq/execution-engine';
import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { FactoryPipelineCoordinator } from '@brq/factory-pipeline';
import type { JobQueue, JobRecord } from '@brq/job-queue';
import type { Logger } from '@brq/shared/logger/logger';

export interface ExecutionDispatcher {
  dispatch(request: ExecutionRequest): Promise<JobRecord>;
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

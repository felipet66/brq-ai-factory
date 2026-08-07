import type { ExecutionEngine, ExecutionRequest } from '@brq/execution-engine';
import type { ExecutionRecordRepository } from '@brq/execution-repository';
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

export interface CreateExecutionWorkerOptions {
  readonly queue: JobQueue;
  readonly engine: ExecutionEngine;
  readonly repository: ExecutionRecordRepository;
  readonly logger?: Logger;
}

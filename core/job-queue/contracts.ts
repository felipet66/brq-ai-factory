import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  claimedJobSchema,
  enqueueJobInputSchema,
  jobFailureSchema,
  jobRecordSchema,
  jobStatusSchema,
  queueEventSchema,
  queueEventTypeSchema,
  queueMetricsSchema,
} from './schemas';

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type QueueEventType = z.infer<typeof queueEventTypeSchema>;
export type JobFailure = DeepReadonly<z.infer<typeof jobFailureSchema>>;
export type QueueEvent = DeepReadonly<z.infer<typeof queueEventSchema>>;
export type QueueEvents = readonly QueueEvent[];
export type JobRecord = DeepReadonly<z.infer<typeof jobRecordSchema>>;
export type EnqueueJobInput = DeepReadonly<z.input<typeof enqueueJobInputSchema>>;
export type ClaimedJob = DeepReadonly<z.infer<typeof claimedJobSchema>>;
export type QueueMetrics = DeepReadonly<z.infer<typeof queueMetricsSchema>>;

export type QueueEventListener = (event: QueueEvent) => void;

export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<JobRecord>;
  claimNext(): Promise<ClaimedJob | null>;
  complete(jobId: string): Promise<JobRecord>;
  fail(jobId: string, failure: JobFailure): Promise<JobRecord>;
  cancel(jobId: string): Promise<JobRecord>;
  get(jobId: string): Promise<JobRecord | null>;
  getEvents(jobId?: string): Promise<QueueEvents>;
  getMetrics(): Promise<QueueMetrics>;
  subscribe(listener: QueueEventListener): () => void;
  shutdown(): Promise<void>;
  isShutdown(): boolean;
}

export interface CreateInMemoryJobQueueOptions {
  readonly logger?: Logger;
  readonly now?: () => number;
}

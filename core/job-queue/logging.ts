import type { Logger } from '@brq/shared/logger/logger';

import type { JobRecord, QueueEvent } from './contracts';

export function logQueueEvent(logger: Logger | undefined, event: QueueEvent): void {
  if (logger === undefined) return;
  const level =
    event.type === 'job.failed' ? 'error' : event.type === 'job.cancelled' ? 'warn' : 'info';
  logger[level](event.type, {
    jobId: event.jobId,
    executionId: event.executionId,
    workflowId: event.workflowId,
    status: event.status,
    ...(event.durationMs === null ? {} : { durationMs: event.durationMs }),
    ...(event.errorCode === null ? {} : { error: { code: event.errorCode } }),
  });
}

export function logQueueShutdown(logger: Logger | undefined, metrics: JobRecord[]): void {
  if (logger === undefined) return;
  logger.info('job.queue.shutdown', {
    cancelledJobs: metrics.filter((job) => job.status === 'CANCELLED').length,
    runningJobs: metrics.filter((job) => job.status === 'RUNNING').length,
  });
}

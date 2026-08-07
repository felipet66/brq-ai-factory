import type { ExecutionRecord } from '@brq/execution-repository';

import { jobLookupDataSchema } from './schemas';

export function toJobLookupData(record: ExecutionRecord) {
  if (record.executionId === null || record.job === null) {
    throw new TypeError('A persisted job lookup requires execution and job metadata.');
  }
  return jobLookupDataSchema.parse({
    jobId: record.job.jobId,
    executionId: record.executionId,
    status: record.job.status,
    queuedAt: record.job.queuedAt,
    startedAt: record.job.startedAt,
    finishedAt: record.job.finishedAt,
  });
}

import { describe, expect, it } from 'vitest';

import * as publicApi from './index';

describe('job queue public exports', () => {
  it('exports the replaceable port adapter, schemas and errors', () => {
    expect(publicApi.createInMemoryJobQueue).toBeTypeOf('function');
    expect(publicApi.jobRecordSchema).toBeDefined();
    expect(publicApi.queueEventSchema).toBeDefined();
    expect(publicApi.queueMetricsSchema).toBeDefined();
    expect(publicApi.JobQueueError).toBeTypeOf('function');
    expect(publicApi.JOB_QUEUE_ERROR_CODES.SHUTDOWN).toBe('JOB_QUEUE_SHUTDOWN');
  });
});

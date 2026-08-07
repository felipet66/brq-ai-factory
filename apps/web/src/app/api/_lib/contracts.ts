import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { ExecutionDispatcher } from '@brq/execution-worker';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  apiErrorSchema,
  errorResponseSchema,
  executionAcceptedResponseSchema,
  executionHttpRequestSchema,
  executionHistoryDetailResponseSchema,
  executionHistoryPageResponseSchema,
  executionListQueryHttpSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
  jobLookupResponseSchema,
} from './schemas';

export type ExecutionHttpRequest = z.infer<typeof executionHttpRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ExecutionAcceptedResponse = z.infer<typeof executionAcceptedResponseSchema>;
export type ExecutionListQueryHttp = z.infer<typeof executionListQueryHttpSchema>;
export type ExecutionHistoryPageResponse = z.infer<typeof executionHistoryPageResponseSchema>;
export type ExecutionHistoryDetailResponse = z.infer<typeof executionHistoryDetailResponseSchema>;
export type ExecutionTimelineResponse = z.infer<typeof executionTimelineResponseSchema>;
export type JobLookupResponse = z.infer<typeof jobLookupResponseSchema>;

export type RequestIdFactory = () => string;

export interface HttpAdapterDependencies {
  readonly getExecutionDispatcher: () => Promise<ExecutionDispatcher>;
  readonly getExecutionRepository: () => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

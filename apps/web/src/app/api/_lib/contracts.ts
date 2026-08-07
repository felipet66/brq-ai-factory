import type { ExecutionEngine } from '@brq/execution-engine';
import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  apiErrorSchema,
  errorResponseSchema,
  executionHttpRequestSchema,
  executionHistoryDetailResponseSchema,
  executionHistoryPageResponseSchema,
  executionListQueryHttpSchema,
  executionResponseSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
} from './schemas';

export type ExecutionHttpRequest = z.infer<typeof executionHttpRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;
export type ExecutionListQueryHttp = z.infer<typeof executionListQueryHttpSchema>;
export type ExecutionHistoryPageResponse = z.infer<typeof executionHistoryPageResponseSchema>;
export type ExecutionHistoryDetailResponse = z.infer<typeof executionHistoryDetailResponseSchema>;
export type ExecutionTimelineResponse = z.infer<typeof executionTimelineResponseSchema>;

export type RequestIdFactory = () => string;

export interface HttpAdapterDependencies {
  readonly getExecutionEngine: () => Promise<ExecutionEngine>;
  readonly getExecutionRepository: () => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

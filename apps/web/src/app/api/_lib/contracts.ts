import type { ExecutionEngine } from '@brq/execution-engine';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type {
  apiErrorSchema,
  errorResponseSchema,
  executionHttpRequestSchema,
  executionResponseSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
} from './schemas';

export type ExecutionHttpRequest = z.infer<typeof executionHttpRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ExecutionResponse = z.infer<typeof executionResponseSchema>;
export type ExecutionTimelineResponse = z.infer<typeof executionTimelineResponseSchema>;

export type RequestIdFactory = () => string;

export interface HttpAdapterDependencies {
  readonly getExecutionEngine: () => Promise<ExecutionEngine>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

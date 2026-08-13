import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { ExecutionDispatcher } from '@brq/execution-worker';
import type { Logger } from '@brq/shared/logger/logger';
import type { z } from 'zod';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';

import type {
  apiErrorSchema,
  errorResponseSchema,
  executionAcceptedResponseSchema,
  executionRerunAcceptedResponseSchema,
  executionHttpRequestSchema,
  executionHistoryDetailResponseSchema,
  executionHistoryPageResponseSchema,
  executionListQueryHttpSchema,
  executionTimelineResponseSchema,
  healthResponseSchema,
  jobLookupResponseSchema,
  loginHttpRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
} from './schemas';

export type ExecutionHttpRequest = z.infer<typeof executionHttpRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ExecutionAcceptedResponse = z.infer<typeof executionAcceptedResponseSchema>;
export type ExecutionRerunAcceptedResponse = z.infer<typeof executionRerunAcceptedResponseSchema>;
export type ExecutionListQueryHttp = z.infer<typeof executionListQueryHttpSchema>;
export type ExecutionHistoryPageResponse = z.infer<typeof executionHistoryPageResponseSchema>;
export type ExecutionHistoryDetailResponse = z.infer<typeof executionHistoryDetailResponseSchema>;
export type ExecutionTimelineResponse = z.infer<typeof executionTimelineResponseSchema>;
export type JobLookupResponse = z.infer<typeof jobLookupResponseSchema>;
export type LoginHttpRequest = z.infer<typeof loginHttpRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type LogoutResponse = z.infer<typeof logoutResponseSchema>;

export type RequestIdFactory = () => string;

export interface HttpAdapterDependencies {
  readonly authenticate: RequestAuthenticator;
  readonly getExecutionDispatcher: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionDispatcher>;
  readonly getExecutionRepository: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

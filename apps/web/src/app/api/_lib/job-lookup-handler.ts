import type { ExecutionRecordRepository } from '@brq/execution-repository';
import type { Logger } from '@brq/shared/logger/logger';

import { API_ENDPOINTS, API_ERROR_CODES } from './constants';
import type { RequestIdFactory } from './contracts';
import { HttpApiError } from './errors';
import { executeRepositoryQuery, resolveExecutionRepository } from './execution-repository';
import { toJobLookupData } from './job-projection';
import { rejectQueryParameters } from './request';
import { jobLookupResponse } from './responses';
import { createRouteHandler } from './route-handler';
import { jobIdPathSchema } from './schemas';

export interface JobLookupContext {
  readonly params: Promise<{ readonly id: string }>;
}

interface JobLookupHandlerOptions {
  readonly getExecutionRepository: () => Promise<ExecutionRecordRepository>;
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

export function createJobLookupHandler(options: JobLookupHandlerOptions) {
  return createRouteHandler<JobLookupContext>({
    endpoint: API_ENDPOINTS.JOB_BY_ID,
    allowedMethods: ['GET'],
    ...options,
    async operation(request, context, requestId) {
      rejectQueryParameters(request);
      const { id } = await context.params;
      if (!jobIdPathSchema.safeParse(id).success) {
        throw new HttpApiError('O identificador do job é inválido.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'id',
        });
      }

      const repository = await resolveExecutionRepository(options.getExecutionRepository);
      const record = await executeRepositoryQuery(() => repository.findByJobId(id));
      if (record === null) {
        throw new HttpApiError('O job não foi encontrado.', {
          code: API_ERROR_CODES.JOB_NOT_FOUND,
          status: 404,
          jobId: id,
        });
      }
      const job = toJobLookupData(record);
      if (job.jobId !== id) {
        throw new TypeError('The persisted job does not match the requested identifier.');
      }
      return {
        response: jobLookupResponse(job, requestId),
        executionId: job.executionId,
        jobId: job.jobId,
      };
    },
  });
}

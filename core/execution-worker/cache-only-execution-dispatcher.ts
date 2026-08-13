import type { ExecutionRequest } from '@brq/execution-engine';

import type {
  CacheOnlyExecutionDispatchContext,
  CacheOnlyExecutionDispatcher,
  ExecutionDispatcherWithOptions,
} from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';

/** Adapts the queue dispatcher while making REQUIRE_HIT an explicit, non-optional enqueue fact. */
export function createCacheOnlyExecutionDispatcher(
  dispatcher: ExecutionDispatcherWithOptions,
): CacheOnlyExecutionDispatcher {
  if (typeof dispatcher?.dispatchWithOptions !== 'function') {
    throw new ExecutionWorkerError('Dispatcher cache-only inválido.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }

  return Object.freeze({
    dispatchCacheOnly(request: ExecutionRequest, context: CacheOnlyExecutionDispatchContext) {
      if (context.mode !== 'REQUIRE_CACHE_HIT') {
        throw new ExecutionWorkerError('Modo de rerun inválido.', {
          code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
        });
      }
      return dispatcher.dispatchWithOptions(request, {
        cacheMode: 'REQUIRE_HIT',
        sourceExecutionId: context.sourceExecutionId,
      });
    },
  });
}

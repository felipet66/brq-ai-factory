import { deriveExecutionIdentity, type ExecutionRequest } from '@brq/execution-engine';

import type { ExecutionDispatcher, SnapshottingExecutionDispatcherOptions } from './contracts';
import { EXECUTION_WORKER_ERROR_CODES, ExecutionWorkerError } from './errors';

function isoNow(now: () => number): string {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new ExecutionWorkerError('Fonte temporal do snapshot inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CLOCK,
    });
  }
  return new Date(Math.max(0, Math.round(value))).toISOString();
}

/** Captures an immutable request snapshot before handing the request to the normal dispatcher. */
export function createSnapshottingExecutionDispatcher(
  options: SnapshottingExecutionDispatcherOptions,
): ExecutionDispatcher {
  if (
    typeof options.dispatcher?.dispatch !== 'function' ||
    typeof options.snapshots?.save !== 'function' ||
    typeof options.ownerId !== 'string' ||
    options.ownerId.trim().length === 0 ||
    (options.now !== undefined && typeof options.now !== 'function')
  ) {
    throw new ExecutionWorkerError('Configuração do dispatcher com snapshot inválida.', {
      code: EXECUTION_WORKER_ERROR_CODES.INVALID_CONFIGURATION,
    });
  }
  const now = options.now ?? Date.now;

  return Object.freeze({
    async dispatch(request: ExecutionRequest) {
      const identity = deriveExecutionIdentity(request);
      await options.snapshots.save({
        ownerId: options.ownerId,
        request,
        replaySourceExecutionId: null,
        replayCacheExecutionId: null,
        replayMode: null,
        createdAt: isoNow(now),
      });
      const job = await options.dispatcher.dispatch(request);
      if (job.executionId !== identity.executionId) {
        throw new ExecutionWorkerError('O job não corresponde ao snapshot capturado.', {
          code: EXECUTION_WORKER_ERROR_CODES.DISPATCH_FAILED,
        });
      }
      return job;
    },
  });
}

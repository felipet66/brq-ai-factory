import {
  ExecutionEngineError,
  type ExecutionEngine,
  type ExecutionOptions,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';

import type { CreateObservedExecutionEngineOptions } from './contracts';

export function createObservedExecutionEngine(
  options: CreateObservedExecutionEngineOptions,
): ExecutionEngine {
  if (typeof options.engine?.execute !== 'function')
    throw new TypeError('ExecutionEngine inválido.');

  const record = (operation: () => void): void => {
    try {
      operation();
    } catch {
      // Observability is fail-open and must never change execution semantics.
    }
  };

  return Object.freeze({
    async execute(
      request: ExecutionRequest,
      executionOptions?: ExecutionOptions,
    ): Promise<ExecutionResult> {
      record(() => options.history.begin(request));
      try {
        const result = await options.engine.execute(request, executionOptions);
        record(() => options.history.complete(result));
        return result;
      } catch (error) {
        if (error instanceof ExecutionEngineError && error.result !== undefined) {
          record(() => options.history.complete(error.result!));
        }
        throw error;
      }
    },
  });
}

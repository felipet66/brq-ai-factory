import {
  FactoryPipelineError,
  type FactoryExecutionResult,
  type FactoryPipelineCoordinator,
  type FactoryPipelineRunOptions,
} from '@brq/factory-pipeline';
import type { ExecutionRequest } from '@brq/execution-engine';

import type { CreateObservedFactoryPipelineOptions } from './contracts';

export function createObservedFactoryPipeline(
  options: CreateObservedFactoryPipelineOptions,
): FactoryPipelineCoordinator {
  if (
    typeof options.pipeline?.execute !== 'function' ||
    typeof options.history?.beginFactory !== 'function' ||
    typeof options.history?.completeFactory !== 'function'
  ) {
    throw new TypeError('Configuração do pipeline observado inválida.');
  }

  const record = (operation: () => void): void => {
    try {
      operation();
    } catch {
      // Observability is fail-open and must never change Factory execution semantics.
    }
  };

  return Object.freeze({
    ...(options.pipeline.preflight === undefined
      ? {}
      : {
          preflight: options.pipeline.preflight.bind(options.pipeline),
        }),
    ...(options.pipeline.resumeTechnical === undefined
      ? {}
      : {
          resumeTechnical: options.pipeline.resumeTechnical.bind(options.pipeline),
        }),
    async execute(
      request: ExecutionRequest,
      runOptions?: FactoryPipelineRunOptions,
    ): Promise<FactoryExecutionResult> {
      record(() => options.history.beginFactory(request));
      try {
        const result = await options.pipeline.execute(request, runOptions);
        record(() => options.history.completeFactory(result));
        return result;
      } catch (error) {
        if (error instanceof FactoryPipelineError && error.result !== undefined) {
          record(() => options.history.completeFactory(error.result!));
        }
        throw error;
      }
    },
  });
}

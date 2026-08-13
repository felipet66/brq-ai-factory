import type { LogContext, Logger } from '@brq/shared/logger/logger';

import type { FactoryPipelineFailure, FactoryPipelineHashes } from './contracts';
import type { FactoryPipelineStageId } from './state-machine';

export function factoryPipelineLogContext(input: {
  readonly executionId: string;
  readonly workflowId: string;
  readonly stage?: FactoryPipelineStageId;
  readonly status?: string;
  readonly durationMs?: number;
  readonly outputHash?: string | null;
  readonly hashes?: Partial<FactoryPipelineHashes>;
  readonly failure?: FactoryPipelineFailure;
}): LogContext {
  return {
    executionId: input.executionId,
    workflowId: input.workflowId,
    ...(input.stage === undefined ? {} : { stage: input.stage }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.outputHash === undefined ? {} : { outputHash: input.outputHash }),
    ...(input.hashes === undefined ? {} : { hashes: input.hashes }),
    ...(input.failure === undefined
      ? {}
      : {
          error: {
            code: input.failure.code,
            stage: input.failure.stage,
            ...(input.failure.sourceCode === null ? {} : { sourceCode: input.failure.sourceCode }),
            ...(input.failure.reasonCode === null ? {} : { reasonCode: input.failure.reasonCode }),
            ...(input.failure.profileRuleId === null
              ? {}
              : { profileRuleId: input.failure.profileRuleId }),
            ...(input.failure.diagnosticSummary === null
              ? {}
              : { diagnosticSummary: input.failure.diagnosticSummary }),
          },
        }),
  };
}

export function logFactoryPipelineEvent(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: LogContext,
): void {
  try {
    logger?.[level](event, context);
  } catch {
    // Observability is best effort and cannot change Factory outcomes.
  }
}

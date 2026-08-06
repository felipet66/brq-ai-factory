import type { LogContext } from '@brq/shared/logger/logger';

import type { WorkflowFailure, WorkflowHashes, WorkflowMetrics, WorkflowStage } from './contracts';

type AgentName = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA';

export function workflowLogContext(
  workflowId: string,
  executionId: string,
  stage: WorkflowStage,
  options: {
    readonly agent?: AgentName;
    readonly durationMs?: number;
    readonly hashes?: Partial<WorkflowHashes>;
    readonly metrics?: WorkflowMetrics;
    readonly failure?: WorkflowFailure;
  } = {},
): LogContext {
  return {
    workflowId,
    executionId,
    stage,
    ...(options.agent === undefined ? {} : { agent: options.agent }),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    ...(options.hashes === undefined ? {} : { hashes: options.hashes }),
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(options.failure === undefined
      ? {}
      : {
          error: {
            code: options.failure.code,
            ...(options.failure.sourceCode === null
              ? {}
              : { sourceCode: options.failure.sourceCode }),
          },
        }),
  };
}

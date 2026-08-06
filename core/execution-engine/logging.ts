import type { LogContext } from '@brq/shared/logger/logger';

import type {
  ExecutionFailure,
  ExecutionHashes,
  ExecutionMetrics,
  ExecutionState,
} from './contracts';

export function executionLogContext(
  executionId: string,
  workflowId: string,
  state: ExecutionState,
  metadata: { readonly engineVersion: string; readonly contractVersion: string },
  options: {
    readonly status?: 'SUCCESS' | 'FAILED' | 'CANCELLED';
    readonly durationMs?: number;
    readonly hashes?: Partial<ExecutionHashes>;
    readonly metrics?: ExecutionMetrics;
    readonly failure?: ExecutionFailure;
    readonly lineage?: { readonly hash: string | null; readonly verifiedHandoffs: number };
  } = {},
): LogContext {
  return {
    executionId,
    workflowId,
    state,
    engineVersion: metadata.engineVersion,
    contractVersion: metadata.contractVersion,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    ...(options.hashes === undefined ? {} : { hashes: options.hashes }),
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(options.lineage === undefined ? {} : { lineage: options.lineage }),
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

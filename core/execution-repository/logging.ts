import type { Logger } from '@brq/shared/logger/logger';

export function logRepositoryOperation(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: {
    readonly workflowId?: string;
    readonly executionId?: string | null;
    readonly jobId?: string;
    readonly stage?: string;
    readonly status?: string;
    readonly durationMs?: number;
    readonly count?: number;
    readonly errorCode?: string;
  },
): void {
  if (logger === undefined) return;
  try {
    logger[level](event, {
      ...(context.workflowId === undefined ? {} : { workflowId: context.workflowId }),
      ...(context.executionId === undefined ? {} : { executionId: context.executionId }),
      ...(context.jobId === undefined ? {} : { jobId: context.jobId }),
      ...(context.stage === undefined ? {} : { stage: context.stage }),
      ...(context.status === undefined ? {} : { status: context.status }),
      ...(context.durationMs === undefined ? {} : { durationMs: context.durationMs }),
      ...(context.count === undefined ? {} : { count: context.count }),
      ...(context.errorCode === undefined ? {} : { error: { code: context.errorCode } }),
    });
  } catch {
    // Repository logging is observational and must not alter persistence outcomes.
  }
}

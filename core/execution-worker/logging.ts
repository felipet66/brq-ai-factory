import type { Logger } from '@brq/shared/logger/logger';

export function logWorkerEvent(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: {
    readonly jobId?: string;
    readonly executionId?: string;
    readonly workflowId?: string;
    readonly status?: string;
    readonly errorCode?: string;
  },
): void {
  if (logger === undefined) return;
  logger[level](event, {
    ...(context.jobId === undefined ? {} : { jobId: context.jobId }),
    ...(context.executionId === undefined ? {} : { executionId: context.executionId }),
    ...(context.workflowId === undefined ? {} : { workflowId: context.workflowId }),
    ...(context.status === undefined ? {} : { status: context.status }),
    ...(context.errorCode === undefined ? {} : { error: { code: context.errorCode } }),
  });
}

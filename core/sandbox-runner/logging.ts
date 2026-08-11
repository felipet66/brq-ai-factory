import type { LogContext, Logger } from '@brq/shared/logger/logger';

import type { SandboxFailure, SandboxHashes, SandboxResourceOutcome } from './contracts';
import type { SandboxStepId, SandboxTerminalStatus } from './lifecycle';

export function sandboxLogContext(input: {
  readonly sandboxRunId: string;
  readonly executionId: string;
  readonly workspaceId: string;
  readonly policyId: string;
  readonly status?: SandboxTerminalStatus;
  readonly stepId?: SandboxStepId;
  readonly durationMs?: number;
  readonly exitCode?: number | null;
  readonly observedBytes?: number;
  readonly truncated?: boolean;
  readonly resourceOutcome?: SandboxResourceOutcome;
  readonly hashes?: Partial<SandboxHashes>;
  readonly failure?: SandboxFailure;
}): LogContext {
  return {
    sandboxRunId: input.sandboxRunId,
    executionId: input.executionId,
    workspaceId: input.workspaceId,
    policyId: input.policyId,
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.stepId === undefined ? {} : { stepId: input.stepId }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.observedBytes === undefined ? {} : { observedBytes: input.observedBytes }),
    ...(input.truncated === undefined ? {} : { truncated: input.truncated }),
    ...(input.resourceOutcome === undefined ? {} : { resourceOutcome: input.resourceOutcome }),
    ...(input.hashes === undefined ? {} : { hashes: input.hashes }),
    ...(input.failure === undefined
      ? {}
      : {
          error: {
            code: input.failure.code,
            stage: input.failure.stage,
            ...(input.failure.sourceCode === null ? {} : { sourceCode: input.failure.sourceCode }),
            ...(input.failure.reasonCode === null ? {} : { reasonCode: input.failure.reasonCode }),
          },
        }),
  };
}

export function logSandboxEvent(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: LogContext,
): void {
  try {
    logger?.[level](event, context);
  } catch {
    // Observability is best effort and never changes sandbox lifecycle outcomes.
  }
}

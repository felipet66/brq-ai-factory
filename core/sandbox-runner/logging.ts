import type { LogContext, Logger } from '@brq/shared/logger/logger';

import type { SandboxFailure, SandboxHashes, SandboxResourceOutcome } from './contracts';
import type { SandboxDockerOperationId, SandboxStepId, SandboxTerminalStatus } from './lifecycle';

export function sandboxDockerOperationLogContext(input: {
  readonly phase: 'PREFLIGHT' | 'RUN';
  readonly policyId: string;
  readonly operation: SandboxDockerOperationId;
  readonly durationMs: number;
  readonly timeoutMs: number;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly sandboxRunId?: string;
  readonly executionId?: string;
  readonly workspaceId?: string;
}): LogContext {
  return {
    phase: input.phase,
    policyId: input.policyId,
    operation: input.operation,
    durationMs: input.durationMs,
    timeoutMs: input.timeoutMs,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    cancelled: input.cancelled,
    ...(input.sandboxRunId === undefined ? {} : { sandboxRunId: input.sandboxRunId }),
    ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
  };
}

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
            ...(input.failure.diagnosticSummary === null
              ? {}
              : { diagnosticSummary: input.failure.diagnosticSummary }),
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

import type { Logger } from '@brq/shared/logger/logger';

import type { PromptInspectionAgent, PromptInspectionStage } from './contracts';

interface PromptInspectionLogContext {
  readonly agent?: PromptInspectionAgent;
  readonly stage?: PromptInspectionStage;
  readonly status?: string;
  readonly promptHash?: string;
  readonly candidateHash?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
}

export function logPromptInspection(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: PromptInspectionLogContext,
): void {
  if (logger === undefined) return;

  logger[level](event, {
    ...(context.agent === undefined ? {} : { agent: context.agent }),
    ...(context.stage === undefined ? {} : { stage: context.stage }),
    ...(context.status === undefined ? {} : { status: context.status }),
    ...(context.promptHash === undefined ? {} : { promptHash: context.promptHash }),
    ...(context.candidateHash === undefined ? {} : { candidateHash: context.candidateHash }),
    ...(context.durationMs === undefined ? {} : { durationMs: context.durationMs }),
    ...(context.errorCode === undefined ? {} : { error: { code: context.errorCode } }),
  });
}

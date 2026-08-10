import type { LogContext, Logger } from '@brq/shared/logger/logger';

import type { PreviewSession } from './contracts';

export function previewSessionLogContext(session: PreviewSession): LogContext {
  return {
    previewId: session.previewId,
    executionId: session.executionId,
    status: session.status,
    health: session.health,
    policyId: session.policy.id,
    hashes: {
      artifactHash: session.hashes.artifactHash,
      previewRequestHash: session.hashes.previewRequestHash,
      previewSessionHash: session.hashes.previewSessionHash,
    },
    ...(session.failure === null
      ? {}
      : {
          error: {
            code: session.failure.code,
            stage: session.failure.stage,
            ...(session.failure.sourceCode === null
              ? {}
              : { sourceCode: session.failure.sourceCode }),
          },
        }),
  };
}

export function logPreviewEvent(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: LogContext,
): void {
  try {
    logger?.[level](event, context);
  } catch {
    // Observability is best effort and cannot change Preview lifecycle.
  }
}

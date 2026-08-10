import type { LogContext, Logger } from '@brq/shared/logger/logger';

import type { PreviewArtifactDescriptor } from './contracts';

export function previewArtifactLogContext(descriptor: PreviewArtifactDescriptor): LogContext {
  return {
    artifactId: descriptor.artifactId,
    executionId: descriptor.source.executionId,
    status: descriptor.status,
    profileId: descriptor.metadata.profileId,
    fileCount: descriptor.metadata.fileCount,
    totalBytes: descriptor.metadata.totalBytes,
    hashes: descriptor.hashes,
  };
}

export function logPreviewArtifactEvent(
  logger: Logger | undefined,
  level: 'info' | 'warn' | 'error',
  event: string,
  context: LogContext,
): void {
  try {
    logger?.[level](event, context);
  } catch {
    // Observability is best effort and cannot change artifact integrity.
  }
}

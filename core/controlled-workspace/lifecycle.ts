import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from './errors';

export const DEFAULT_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS = 10_000;
export const MAX_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS = 30_000;

export function resolveControlledWorkspaceCleanupTimeout(timeoutMs?: number): number {
  const resolved = timeoutMs ?? DEFAULT_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS;
  if (
    !Number.isInteger(resolved) ||
    resolved <= 0 ||
    resolved > MAX_CONTROLLED_WORKSPACE_CLEANUP_TIMEOUT_MS
  ) {
    throw new ControlledWorkspaceError('O deadline de cleanup do workspace é inválido.', {
      code: CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_CONFIGURATION,
      stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CONFIGURATION,
    });
  }
  return resolved;
}

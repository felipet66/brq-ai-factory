import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
} from '../errors';
import { filesystemErrorCode, type WorkspaceFileSystem } from './file-system';

const NOT_FOUND = 'ENOENT';

function cleanupFailure(workspaceId: string, error?: unknown): ControlledWorkspaceError {
  const sourceCode = filesystemErrorCode(error);
  return new ControlledWorkspaceError('Não foi possível remover o workspace controlado.', {
    code: CONTROLLED_WORKSPACE_ERROR_CODES.CLEANUP_FAILED,
    stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
    workspaceId,
    ...(sourceCode === undefined ? {} : { sourceCode }),
  });
}

export async function removeWorkspaceWithDeadline(
  fileSystem: WorkspaceFileSystem,
  targetPath: string,
  timeoutMs: number,
  workspaceId: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(
        new ControlledWorkspaceError('O cleanup do workspace excedeu o deadline.', {
          code: CONTROLLED_WORKSPACE_ERROR_CODES.CLEANUP_TIMEOUT,
          stage: CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
          workspaceId,
        }),
      );
    }, timeoutMs);
  });
  const cleanup = (async () => {
    await fileSystem.rm(targetPath);
    try {
      await fileSystem.lstat(targetPath);
    } catch (error) {
      if (filesystemErrorCode(error) === NOT_FOUND) return;
      throw cleanupFailure(workspaceId, error);
    }
    throw cleanupFailure(workspaceId);
  })();

  try {
    await Promise.race([cleanup, deadline]);
  } catch (error) {
    if (error instanceof ControlledWorkspaceError) throw error;
    throw cleanupFailure(workspaceId, error);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

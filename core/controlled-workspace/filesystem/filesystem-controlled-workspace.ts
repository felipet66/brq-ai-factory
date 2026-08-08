import type { ControlledWorkspace, CreateFilesystemControlledWorkspaceOptions } from '../contracts';
import { NODE_WORKSPACE_FILE_SYSTEM } from './file-system';
import { createFilesystemControlledWorkspaceWithDependencies } from './internal-factory';

export function createFilesystemControlledWorkspace(
  options: CreateFilesystemControlledWorkspaceOptions,
): ControlledWorkspace {
  return createFilesystemControlledWorkspaceWithDependencies(options, {
    fileSystem: NODE_WORKSPACE_FILE_SYSTEM,
  });
}

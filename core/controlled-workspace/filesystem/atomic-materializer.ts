import type { Stats } from 'node:fs';
import path from 'node:path';

import type { WorkspaceMaterializationResult, WorkspacePlan } from '../contracts';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
  type ControlledWorkspaceErrorStage,
} from '../errors';
import { calculateWorkspaceContentHash } from '../hashing';
import { resolveContainedWorkspacePath } from '../path-safety';
import { removeWorkspaceWithDeadline } from './cleanup';
import {
  NODE_WORKSPACE_FILE_SYSTEM,
  filesystemErrorCode,
  type WorkspaceFileSystem,
} from './file-system';

const NOT_FOUND = 'ENOENT';
const DESTINATION_CONFLICT_CODES = new Set(['EEXIST', 'ENOTEMPTY']);

export interface MaterializedWorkspaceOwnership {
  readonly rootRealPath: string;
  readonly rootDevice: number;
  readonly rootInode: number;
  readonly destinationPath: string;
  readonly destinationDevice: number;
  readonly destinationInode: number;
}

interface MaterializationOptions {
  readonly signal?: AbortSignal;
  readonly cleanupTimeoutMs: number;
}

type ExpectedWorkspaceFile = WorkspaceMaterializationResult['files'][number] & {
  readonly content?: string;
};

function fail(
  message: string,
  code: (typeof CONTROLLED_WORKSPACE_ERROR_CODES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_CODES],
  stage: ControlledWorkspaceErrorStage,
  workspaceId: string,
  sourceCode?: string,
): ControlledWorkspaceError {
  return new ControlledWorkspaceError(message, {
    code,
    stage,
    workspaceId,
    ...(sourceCode === undefined ? {} : { sourceCode }),
  });
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  stage: ControlledWorkspaceErrorStage,
  workspaceId: string,
): void {
  if (signal?.aborted !== true) return;
  throw fail(
    'A materialização do workspace foi cancelada.',
    CONTROLLED_WORKSPACE_ERROR_CODES.CANCELLED,
    stage,
    workspaceId,
  );
}

async function assertDirectoryWithoutSymlink(
  fileSystem: WorkspaceFileSystem,
  targetPath: string,
  workspaceId: string,
  stage: ControlledWorkspaceErrorStage,
): Promise<Stats> {
  const stats = await fileSystem.lstat(targetPath);
  if (stats.isSymbolicLink()) {
    throw fail(
      'Links simbólicos não são permitidos no workspace controlado.',
      CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
      stage,
      workspaceId,
    );
  }
  if (!stats.isDirectory()) {
    throw fail(
      'A raiz do workspace controlado deve ser um diretório.',
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
      stage,
      workspaceId,
    );
  }
  return stats;
}

async function assertDestinationAvailable(
  fileSystem: WorkspaceFileSystem,
  destinationPath: string,
  workspaceId: string,
): Promise<void> {
  try {
    await fileSystem.lstat(destinationPath);
  } catch (error) {
    if (filesystemErrorCode(error) === NOT_FOUND) return;
    throw error;
  }
  throw fail(
    'O workspace de destino já existe e não será sobrescrito.',
    CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
    CONTROLLED_WORKSPACE_ERROR_STAGES.COMMIT,
    workspaceId,
  );
}

function plannedDirectories(plan: WorkspacePlan): string[] {
  const directories = new Set<string>();
  for (const file of plan.files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'));
    }
  }
  return [...directories].sort((left, right) => {
    const depthDifference = left.split('/').length - right.split('/').length;
    if (depthDifference !== 0) return depthDifference;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function discoverFiles(
  fileSystem: WorkspaceFileSystem,
  rootPath: string,
  currentPath: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<string[]> {
  throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
  const entries = await fileSystem.readdir(currentPath);
  throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
  const discovered: string[] = [];
  for (const entry of [...entries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
    if (entry.isSymbolicLink()) {
      throw fail(
        'Links simbólicos não são permitidos no workspace materializado.',
        CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        workspaceId,
      );
    }
    const childPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      discovered.push(
        ...(await discoverFiles(fileSystem, rootPath, childPath, workspaceId, signal)),
      );
    } else if (entry.isFile()) {
      discovered.push(path.relative(rootPath, childPath).split(path.sep).join('/'));
    } else {
      throw fail(
        'Somente arquivos regulares e diretórios são permitidos.',
        CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        workspaceId,
      );
    }
  }
  return discovered;
}

async function verifyWorkspaceFiles(
  fileSystem: WorkspaceFileSystem,
  workspacePath: string,
  expectedFiles: readonly ExpectedWorkspaceFile[],
  workspaceId: string,
  signal?: AbortSignal,
): Promise<void> {
  await assertDirectoryWithoutSymlink(
    fileSystem,
    workspacePath,
    workspaceId,
    CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
  );
  throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
  const expectedPaths = expectedFiles.map((file) => file.path);
  const discoveredPaths = (
    await discoverFiles(fileSystem, workspacePath, workspacePath, workspaceId, signal)
  ).sort();
  if (
    expectedPaths.length !== discoveredPaths.length ||
    expectedPaths.some((expected, index) => expected !== discoveredPaths[index])
  ) {
    throw fail(
      'A estrutura escrita não corresponde ao plano autorizado.',
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
      CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
      workspaceId,
    );
  }

  for (const file of expectedFiles) {
    throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
    const filePath = resolveContainedWorkspacePath(workspacePath, file.path);
    const stats = await fileSystem.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw fail(
        'Links simbólicos não são permitidos no workspace materializado.',
        CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        workspaceId,
      );
    }
    if (!stats.isFile()) {
      throw fail(
        'O item materializado não é um arquivo regular.',
        CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        workspaceId,
      );
    }
    const bytes = await fileSystem.readFile(filePath);
    throwIfAborted(signal, CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION, workspaceId);
    if (
      bytes.byteLength !== file.byteLength ||
      calculateWorkspaceContentHash(bytes.toString('utf8')) !== file.contentHash ||
      (file.content !== undefined && !bytes.equals(Buffer.from(file.content, 'utf8')))
    ) {
      throw fail(
        'O conteúdo materializado não corresponde ao hash planejado.',
        CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        workspaceId,
      );
    }
  }
}

async function verifyStaging(
  fileSystem: WorkspaceFileSystem,
  stagingPath: string,
  plan: WorkspacePlan,
  signal?: AbortSignal,
): Promise<void> {
  await verifyWorkspaceFiles(fileSystem, stagingPath, plan.files, plan.workspaceId, signal);
}

function translateFailure(
  error: unknown,
  stage: ControlledWorkspaceErrorStage,
  workspaceId: string,
): ControlledWorkspaceError {
  if (error instanceof ControlledWorkspaceError) return error;
  const sourceCode = filesystemErrorCode(error);
  if (stage === CONTROLLED_WORKSPACE_ERROR_STAGES.COMMIT && sourceCode !== undefined) {
    if (DESTINATION_CONFLICT_CODES.has(sourceCode)) {
      return fail(
        'O workspace de destino já existe e não será sobrescrito.',
        CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
        stage,
        workspaceId,
        sourceCode,
      );
    }
  }
  const code =
    stage === CONTROLLED_WORKSPACE_ERROR_STAGES.ROOT_VALIDATION
      ? CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT
      : stage === CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION
        ? CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED
        : CONTROLLED_WORKSPACE_ERROR_CODES.MATERIALIZATION_FAILED;
  return fail(
    'Não foi possível materializar o workspace controlado.',
    code,
    stage,
    workspaceId,
    sourceCode,
  );
}

function ownershipFailure(workspaceId: string, sourceCode?: string): ControlledWorkspaceError {
  return fail(
    'O workspace não pertence a esta instância controlada.',
    CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_NOT_OWNED,
    CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
    workspaceId,
    sourceCode,
  );
}

async function readOwnedDirectory(
  fileSystem: WorkspaceFileSystem,
  targetPath: string,
  expectedDevice: number,
  expectedInode: number,
  workspaceId: string,
): Promise<Stats> {
  let stats: Stats;
  try {
    stats = await fileSystem.lstat(targetPath);
  } catch (error) {
    throw ownershipFailure(workspaceId, filesystemErrorCode(error));
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.dev !== expectedDevice ||
    stats.ino !== expectedInode
  ) {
    throw ownershipFailure(workspaceId);
  }
  return stats;
}

export async function verifyOwnedMaterializedWorkspace(
  ownership: MaterializedWorkspaceOwnership,
  result: WorkspaceMaterializationResult,
  fileSystem: WorkspaceFileSystem = NODE_WORKSPACE_FILE_SYSTEM,
): Promise<void> {
  await readOwnedDirectory(
    fileSystem,
    ownership.rootRealPath,
    ownership.rootDevice,
    ownership.rootInode,
    result.workspaceId,
  );
  let currentRootRealPath: string;
  try {
    currentRootRealPath = await fileSystem.realpath(ownership.rootRealPath);
  } catch (error) {
    throw ownershipFailure(result.workspaceId, filesystemErrorCode(error));
  }
  if (currentRootRealPath !== ownership.rootRealPath) {
    throw ownershipFailure(result.workspaceId);
  }
  const expectedDestination = resolveContainedWorkspacePath(
    ownership.rootRealPath,
    result.workspaceId,
  );
  if (expectedDestination !== ownership.destinationPath) {
    throw ownershipFailure(result.workspaceId);
  }
  await readOwnedDirectory(
    fileSystem,
    ownership.destinationPath,
    ownership.destinationDevice,
    ownership.destinationInode,
    result.workspaceId,
  );
  try {
    await verifyWorkspaceFiles(
      fileSystem,
      ownership.destinationPath,
      result.files,
      result.workspaceId,
    );
  } catch (error) {
    if (error instanceof ControlledWorkspaceError) throw error;
    throw fail(
      'Não foi possível verificar o workspace antes do cleanup.',
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
      CONTROLLED_WORKSPACE_ERROR_STAGES.CLEANUP,
      result.workspaceId,
      filesystemErrorCode(error),
    );
  }
}

export async function materializeWorkspaceAtomically(
  plan: WorkspacePlan,
  configuredRootPath: string,
  options: MaterializationOptions,
  fileSystem: WorkspaceFileSystem = NODE_WORKSPACE_FILE_SYSTEM,
): Promise<MaterializedWorkspaceOwnership> {
  let stage: ControlledWorkspaceErrorStage = CONTROLLED_WORKSPACE_ERROR_STAGES.ROOT_VALIDATION;
  let cleanupPath: string | undefined;
  try {
    throwIfAborted(options.signal, stage, plan.workspaceId);
    await assertDirectoryWithoutSymlink(fileSystem, configuredRootPath, plan.workspaceId, stage);
    throwIfAborted(options.signal, stage, plan.workspaceId);
    const rootRealPath = await fileSystem.realpath(configuredRootPath);
    throwIfAborted(options.signal, stage, plan.workspaceId);
    const rootStats = await assertDirectoryWithoutSymlink(
      fileSystem,
      rootRealPath,
      plan.workspaceId,
      stage,
    );
    const destinationPath = resolveContainedWorkspacePath(rootRealPath, plan.workspaceId);
    await assertDestinationAvailable(fileSystem, destinationPath, plan.workspaceId);
    throwIfAborted(options.signal, stage, plan.workspaceId);

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.STAGING;
    const createdStagingPath = await fileSystem.mkdtemp(
      path.join(rootRealPath, '.controlled-workspace-staging-'),
    );
    const stagingName = path.basename(createdStagingPath);
    if (
      path.dirname(createdStagingPath) !== rootRealPath ||
      !stagingName.startsWith('.controlled-workspace-staging-')
    ) {
      throw fail(
        'O diretório de staging está fora da raiz autorizada.',
        CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
        stage,
        plan.workspaceId,
      );
    }
    await assertDirectoryWithoutSymlink(fileSystem, createdStagingPath, plan.workspaceId, stage);
    cleanupPath = createdStagingPath;
    throwIfAborted(options.signal, stage, plan.workspaceId);
    const stagingRealPath = await fileSystem.realpath(createdStagingPath);
    const expectedStagingPath = resolveContainedWorkspacePath(
      rootRealPath,
      path.basename(stagingRealPath),
    );
    if (expectedStagingPath !== stagingRealPath || path.dirname(stagingRealPath) !== rootRealPath) {
      throw fail(
        'O diretório de staging está fora da raiz autorizada.',
        CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
        stage,
        plan.workspaceId,
      );
    }
    await assertDirectoryWithoutSymlink(fileSystem, stagingRealPath, plan.workspaceId, stage);
    throwIfAborted(options.signal, stage, plan.workspaceId);

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.MATERIALIZATION;
    for (const directory of plannedDirectories(plan)) {
      throwIfAborted(options.signal, stage, plan.workspaceId);
      await fileSystem.mkdir(resolveContainedWorkspacePath(stagingRealPath, directory));
      throwIfAborted(options.signal, stage, plan.workspaceId);
    }
    for (const file of plan.files) {
      throwIfAborted(options.signal, stage, plan.workspaceId);
      await fileSystem.writeFile(
        resolveContainedWorkspacePath(stagingRealPath, file.path),
        file.content,
      );
      throwIfAborted(options.signal, stage, plan.workspaceId);
    }

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION;
    await verifyStaging(fileSystem, stagingRealPath, plan, options.signal);

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.COMMIT;
    throwIfAborted(options.signal, stage, plan.workspaceId);
    await assertDestinationAvailable(fileSystem, destinationPath, plan.workspaceId);
    await fileSystem.rename(stagingRealPath, destinationPath);
    cleanupPath = destinationPath;
    throwIfAborted(options.signal, stage, plan.workspaceId);

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION;
    await verifyStaging(fileSystem, destinationPath, plan, options.signal);
    const destinationStats = await assertDirectoryWithoutSymlink(
      fileSystem,
      destinationPath,
      plan.workspaceId,
      stage,
    );
    throwIfAborted(options.signal, stage, plan.workspaceId);
    cleanupPath = undefined;
    return Object.freeze({
      rootRealPath,
      rootDevice: rootStats.dev,
      rootInode: rootStats.ino,
      destinationPath,
      destinationDevice: destinationStats.dev,
      destinationInode: destinationStats.ino,
    });
  } catch (error) {
    const translated = translateFailure(error, stage, plan.workspaceId);
    if (cleanupPath !== undefined) {
      await removeWorkspaceWithDeadline(
        fileSystem,
        cleanupPath,
        options.cleanupTimeoutMs,
        plan.workspaceId,
      );
    }
    throw translated;
  }
}

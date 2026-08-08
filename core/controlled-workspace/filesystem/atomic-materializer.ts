import path from 'node:path';

import type { WorkspacePlan } from '../contracts';
import {
  CONTROLLED_WORKSPACE_ERROR_CODES,
  CONTROLLED_WORKSPACE_ERROR_STAGES,
  ControlledWorkspaceError,
  type ControlledWorkspaceErrorStage,
} from '../errors';
import { calculateWorkspaceContentHash } from '../hashing';
import { resolveContainedWorkspacePath } from '../path-safety';
import {
  NODE_WORKSPACE_FILE_SYSTEM,
  filesystemErrorCode,
  type WorkspaceFileSystem,
} from './file-system';

const NOT_FOUND = 'ENOENT';
const DESTINATION_CONFLICT_CODES = new Set(['EEXIST', 'ENOTEMPTY']);

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

async function assertDirectoryWithoutSymlink(
  fileSystem: WorkspaceFileSystem,
  targetPath: string,
  workspaceId: string,
  stage: ControlledWorkspaceErrorStage,
): Promise<void> {
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
): Promise<string[]> {
  const entries = await fileSystem.readdir(currentPath);
  const discovered: string[] = [];
  for (const entry of [...entries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
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
      discovered.push(...(await discoverFiles(fileSystem, rootPath, childPath, workspaceId)));
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

async function verifyStaging(
  fileSystem: WorkspaceFileSystem,
  stagingPath: string,
  plan: WorkspacePlan,
): Promise<void> {
  await assertDirectoryWithoutSymlink(
    fileSystem,
    stagingPath,
    plan.workspaceId,
    CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
  );
  const expectedPaths = plan.files.map((file) => file.path);
  const discoveredPaths = (
    await discoverFiles(fileSystem, stagingPath, stagingPath, plan.workspaceId)
  ).sort();
  if (
    expectedPaths.length !== discoveredPaths.length ||
    expectedPaths.some((expected, index) => expected !== discoveredPaths[index])
  ) {
    throw fail(
      'A estrutura escrita não corresponde ao plano autorizado.',
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
      CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
      plan.workspaceId,
    );
  }

  for (const file of plan.files) {
    const filePath = resolveContainedWorkspacePath(stagingPath, file.path);
    const stats = await fileSystem.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw fail(
        'Links simbólicos não são permitidos no workspace materializado.',
        CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        plan.workspaceId,
      );
    }
    if (!stats.isFile()) {
      throw fail(
        'O item materializado não é um arquivo regular.',
        CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        plan.workspaceId,
      );
    }
    const bytes = await fileSystem.readFile(filePath);
    const content = bytes.toString('utf8');
    if (
      bytes.byteLength !== file.byteLength ||
      !bytes.equals(Buffer.from(file.content, 'utf8')) ||
      calculateWorkspaceContentHash(content) !== file.contentHash
    ) {
      throw fail(
        'O conteúdo materializado não corresponde ao hash planejado.',
        CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
        CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION,
        plan.workspaceId,
      );
    }
  }
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

export async function materializeWorkspaceAtomically(
  plan: WorkspacePlan,
  configuredRootPath: string,
  fileSystem: WorkspaceFileSystem = NODE_WORKSPACE_FILE_SYSTEM,
): Promise<void> {
  let stage: ControlledWorkspaceErrorStage = CONTROLLED_WORKSPACE_ERROR_STAGES.ROOT_VALIDATION;
  let authorizedStagingPath: string | undefined;
  let publishedPath: string | undefined;
  try {
    await assertDirectoryWithoutSymlink(fileSystem, configuredRootPath, plan.workspaceId, stage);
    const rootRealPath = await fileSystem.realpath(configuredRootPath);
    await assertDirectoryWithoutSymlink(fileSystem, rootRealPath, plan.workspaceId, stage);
    const destinationPath = resolveContainedWorkspacePath(rootRealPath, plan.workspaceId);
    await assertDestinationAvailable(fileSystem, destinationPath, plan.workspaceId);

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
    authorizedStagingPath = createdStagingPath;
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

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.MATERIALIZATION;
    for (const directory of plannedDirectories(plan)) {
      await fileSystem.mkdir(resolveContainedWorkspacePath(stagingRealPath, directory));
    }
    for (const file of plan.files) {
      await fileSystem.writeFile(
        resolveContainedWorkspacePath(stagingRealPath, file.path),
        file.content,
      );
    }

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION;
    await verifyStaging(fileSystem, stagingRealPath, plan);

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.COMMIT;
    await assertDestinationAvailable(fileSystem, destinationPath, plan.workspaceId);
    await fileSystem.rename(stagingRealPath, destinationPath);
    authorizedStagingPath = undefined;
    publishedPath = destinationPath;

    stage = CONTROLLED_WORKSPACE_ERROR_STAGES.VERIFICATION;
    await verifyStaging(fileSystem, destinationPath, plan);
    publishedPath = undefined;
  } catch (error) {
    const translated = translateFailure(error, stage, plan.workspaceId);
    if (authorizedStagingPath !== undefined) {
      try {
        await fileSystem.rm(authorizedStagingPath);
      } catch {
        // Cleanup is best effort; the authoritative failure remains sanitized and unchanged.
      }
    }
    if (publishedPath !== undefined) {
      try {
        await fileSystem.rm(publishedPath);
      } catch {
        // Cleanup is best effort; the authoritative failure remains sanitized and unchanged.
      }
    }
    throw translated;
  }
}

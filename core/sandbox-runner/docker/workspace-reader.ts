import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS,
  calculateWorkspaceBundleContentHash,
  type WorkspaceMaterializationResult,
} from '@brq/controlled-workspace';

import {
  SANDBOX_RUNNER_ERROR_CODES,
  SANDBOX_RUNNER_ERROR_STAGES,
  SandboxRunnerError,
} from '../errors';

const PRIVATE_KEY_HEADER = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u;
const RECOGNIZABLE_TOKEN =
  /(?:\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/u;
const LITERAL_CREDENTIAL_ASSIGNMENT =
  /(?:\b(?:api[_-]?key|client[_-]?secret|password|secret|access[_-]?token)\b|\b(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\b)\s*[:=]\s*["'][A-Za-z0-9+/_=@.-]{16,}["']/iu;

export interface VerifiedWorkspaceFile {
  readonly path: string;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly content: Buffer;
}

export interface VerifiedWorkspace {
  readonly workspaceId: string;
  readonly workspaceHash: string;
  readonly files: readonly VerifiedWorkspaceFile[];
  readonly totalBytes: number;
}

function integrityError(sourceCode: string): SandboxRunnerError {
  return new SandboxRunnerError(
    'A integridade do workspace materializado não pôde ser confirmada.',
    {
      code: SANDBOX_RUNNER_ERROR_CODES.INTEGRITY_MISMATCH,
      stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
      sourceCode,
    },
  );
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new SandboxRunnerError('A leitura do workspace foi cancelada.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CANCELLED,
      stage: SANDBOX_RUNNER_ERROR_STAGES.INTEGRITY,
    });
  }
}

export function validateWorkspaceRoot(workspaceRoot: string): string {
  if (
    workspaceRoot.length === 0 ||
    workspaceRoot.trim() !== workspaceRoot ||
    workspaceRoot.includes('\u0000') ||
    !path.isAbsolute(workspaceRoot) ||
    path.resolve(workspaceRoot) !== workspaceRoot ||
    path.parse(workspaceRoot).root === workspaceRoot
  ) {
    throw new SandboxRunnerError('A raiz física dos workspaces da sandbox é inválida.', {
      code: SANDBOX_RUNNER_ERROR_CODES.CONFIGURATION_ERROR,
      stage: SANDBOX_RUNNER_ERROR_STAGES.CONFIGURATION,
    });
  }
  return workspaceRoot;
}

function containedPath(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  if (target !== root && target.startsWith(`${root}${path.sep}`)) return target;
  throw integrityError('WORKSPACE_PATH_ESCAPE');
}

async function enumerateFiles(
  directory: string,
  root: string,
  state: { entries: number },
  signal?: AbortSignal,
): Promise<string[]> {
  assertNotAborted(signal);
  const result: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    assertNotAborted(signal);
    state.entries += 1;
    if (
      state.entries >
      CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFiles *
        (CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxPathSegments + 1)
    ) {
      throw integrityError('WORKSPACE_ENTRY_LIMIT');
    }
    if (entry.isSymbolicLink()) throw integrityError('WORKSPACE_SYMLINK');
    const target = containedPath(root, path.relative(root, path.join(directory, entry.name)));
    if (entry.isDirectory()) {
      result.push(...(await enumerateFiles(target, root, state, signal)));
    } else if (entry.isFile()) result.push(path.relative(root, target).split(path.sep).join('/'));
    else throw integrityError('WORKSPACE_SPECIAL_FILE');
  }
  return result.sort();
}

function hasSensitiveContent(content: string): boolean {
  return (
    PRIVATE_KEY_HEADER.test(content) ||
    RECOGNIZABLE_TOKEN.test(content) ||
    LITERAL_CREDENTIAL_ASSIGNMENT.test(content)
  );
}

export async function readAndVerifyWorkspace(
  workspaceRoot: string,
  workspace: WorkspaceMaterializationResult,
  signal?: AbortSignal,
): Promise<VerifiedWorkspace> {
  try {
    assertNotAborted(signal);
    const rootStats = await lstat(workspaceRoot);
    assertNotAborted(signal);
    const canonicalRoot = await realpath(workspaceRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || canonicalRoot !== workspaceRoot) {
      throw integrityError('WORKSPACE_ROOT_ALIAS');
    }
    const directory = containedPath(workspaceRoot, workspace.workspaceId);
    const directoryStats = await lstat(directory);
    assertNotAborted(signal);
    const canonicalDirectory = await realpath(directory);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      canonicalDirectory !== directory
    ) {
      throw integrityError('WORKSPACE_DIRECTORY_ALIAS');
    }

    const expectedPaths = workspace.files.map((file) => file.path).sort();
    const observedPaths = await enumerateFiles(directory, directory, { entries: 0 }, signal);
    if (JSON.stringify(expectedPaths) !== JSON.stringify(observedPaths)) {
      throw integrityError('WORKSPACE_FILE_SET_MISMATCH');
    }

    let totalBytes = 0;
    const files: VerifiedWorkspaceFile[] = [];
    for (const expected of [...workspace.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      assertNotAborted(signal);
      const target = containedPath(directory, expected.path);
      const stats = await lstat(target);
      const canonicalTarget = await realpath(target);
      if (!stats.isFile() || stats.isSymbolicLink() || canonicalTarget !== target) {
        throw integrityError('WORKSPACE_FILE_ALIAS');
      }
      const content = await readFile(target);
      assertNotAborted(signal);
      totalBytes += content.byteLength;
      if (
        content.byteLength !== expected.byteLength ||
        content.byteLength > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxFileBytes ||
        createHash('sha256').update(content).digest('hex') !== expected.contentHash ||
        hasSensitiveContent(content.toString('utf8'))
      ) {
        throw integrityError('WORKSPACE_FILE_MISMATCH');
      }
      files.push(
        Object.freeze({
          path: expected.path,
          byteLength: expected.byteLength,
          contentHash: expected.contentHash,
          content,
        }),
      );
    }

    if (
      totalBytes !== workspace.metadata.totalBytes ||
      totalBytes > CONTROLLED_WORKSPACE_ABSOLUTE_LIMITS.maxBundleBytes ||
      calculateWorkspaceBundleContentHash(workspace.files) !== workspace.source.bundleContentHash
    ) {
      throw integrityError('WORKSPACE_BUNDLE_MISMATCH');
    }
    return Object.freeze({
      workspaceId: workspace.workspaceId,
      workspaceHash: workspace.metadata.workspaceHash,
      files: Object.freeze(files),
      totalBytes,
    });
  } catch (error) {
    if (error instanceof SandboxRunnerError) throw error;
    throw integrityError('WORKSPACE_READ_FAILED');
  }
}

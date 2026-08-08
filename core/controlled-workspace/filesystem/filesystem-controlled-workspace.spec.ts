import { lstat, mkdtemp, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Logger } from '@brq/shared/logger/logger';
import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspacePlan } from '../contracts';
import { CONTROLLED_WORKSPACE_ERROR_CODES, ControlledWorkspaceError } from '../errors';
import { createWorkspacePlanRequestFixture } from '../testing/controlled-workspace-fixtures';
import {
  NODE_WORKSPACE_FILE_SYSTEM,
  filesystemErrorCode,
  type WorkspaceFileSystem,
} from './file-system';
import { createFilesystemControlledWorkspace } from './filesystem-controlled-workspace';
import { createFilesystemControlledWorkspaceWithDependencies } from './internal-factory';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'brq-controlled-workspace-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => NODE_WORKSPACE_FILE_SYSTEM.rm(root)));
});

function expectControlledError(
  error: unknown,
  code: (typeof CONTROLLED_WORKSPACE_ERROR_CODES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_CODES],
): void {
  expect(error).toBeInstanceOf(ControlledWorkspaceError);
  expect((error as ControlledWorkspaceError).code).toBe(code);
}

async function expectControlledRejection(
  operation: Promise<unknown>,
  code: (typeof CONTROLLED_WORKSPACE_ERROR_CODES)[keyof typeof CONTROLLED_WORKSPACE_ERROR_CODES],
): Promise<ControlledWorkspaceError> {
  try {
    await operation;
  } catch (error) {
    expectControlledError(error, code);
    return error as ControlledWorkspaceError;
  }
  throw new Error('Expected ControlledWorkspaceError rejection.');
}

describe('filesystem controlled workspace', () => {
  it('extracts only sanitized filesystem error codes', () => {
    expect(filesystemErrorCode(new Error('failure'))).toBeUndefined();
    expect(filesystemErrorCode({ code: 500 })).toBeUndefined();
    expect(filesystemErrorCode({ code: 'EIO:/private/secret' })).toBeUndefined();
    expect(filesystemErrorCode({ code: 'x-secret' })).toBeUndefined();
    expect(filesystemErrorCode({ code: 'EUNKNOWN_FORGED' })).toBeUndefined();
    expect(filesystemErrorCode({ code: 'EIO', path: '/sensitive' })).toBe('EIO');
  });

  it('materializes in an isolated directory and returns no file content or root path', async () => {
    const root = await temporaryRoot();
    const workspace = createFilesystemControlledWorkspace({ rootPath: root });
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    const result = await workspace.materialize(plan);

    expect(await readFile(path.join(root, result.workspaceId, 'src/index.ts'), 'utf8')).toBe(
      'export const ready = true;\n',
    );
    expect(result.files.every((file) => !('content' in file))).toBe(true);
    expect('rootPath' in result).toBe(false);
    expect(result.lineage).toEqual({
      ...plan.lineage,
      workspaceHash: result.metadata.workspaceHash,
    });
    expect(result.provenance).toMatchObject({
      adapter: 'FILESYSTEM',
      policyHash: plan.metadata.policyHash,
      configurationHash: plan.metadata.configurationHash,
      fileCount: 2,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.provenance)).toBe(true);
    expect((await readdir(root)).filter((entry) => entry.startsWith('.controlled-'))).toEqual([]);
    const directoryMode = (await lstat(path.join(root, result.workspaceId))).mode & 0o777;
    const fileMode =
      (await lstat(path.join(root, result.workspaceId, 'src/index.ts'))).mode & 0o777;
    expect(directoryMode & 0o077).toBe(0);
    expect(fileMode & 0o077).toBe(0);
  });

  it('never overwrites an existing workspace', async () => {
    const root = await temporaryRoot();
    const workspace = createFilesystemControlledWorkspace({ rootPath: root });
    const plan = workspace.plan(createWorkspacePlanRequestFixture());
    await workspace.materialize(plan);
    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
    );
    expect(await readFile(path.join(root, plan.workspaceId, 'src/index.ts'), 'utf8')).toBe(
      'export const ready = true;\n',
    );
  });

  it('revalidates plan hashes before touching the filesystem', async () => {
    const root = await temporaryRoot();
    let writeCalls = 0;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      writeFile: async (targetPath, content) => {
        writeCalls += 1;
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(targetPath, content);
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());
    const first = plan.files[0];
    if (first === undefined) throw new Error('Plan fixture is empty.');
    const tampered = {
      ...plan,
      files: [{ ...first, content: `${first.content}tampered` }, ...plan.files.slice(1)],
    } as WorkspacePlan;

    await expectControlledRejection(
      workspace.materialize(tampered),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    expect(writeCalls).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects sensitive content even when a caller invokes materialize directly', async () => {
    const root = await temporaryRoot();
    let writeCalls = 0;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      writeFile: async (targetPath, content) => {
        writeCalls += 1;
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(targetPath, content);
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());
    const first = plan.files[0];
    if (first === undefined) throw new Error('Plan fixture is empty.');
    const sensitivePlan = {
      ...plan,
      files: [
        { ...first, content: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret' },
        ...plan.files.slice(1),
      ],
    } as WorkspacePlan;

    await expectControlledRejection(
      workspace.materialize(sensitivePlan),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_REQUEST,
    );
    expect(writeCalls).toBe(0);
    expect(await readdir(root)).toEqual([]);
  });

  it('honors the host limits again during materialization', async () => {
    const root = await temporaryRoot();
    const permissive = createFilesystemControlledWorkspace({ rootPath: root });
    const restricted = createFilesystemControlledWorkspace({
      rootPath: root,
      limits: { maxFiles: 1 },
    });
    const plan = permissive.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      restricted.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.LIMIT_EXCEEDED,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans staging and publishes nothing when a write fails', async () => {
    const root = await temporaryRoot();
    let writes = 0;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      writeFile: async (targetPath, content) => {
        writes += 1;
        if (writes === 2) throw Object.assign(new Error('injected'), { code: 'EIO' });
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(targetPath, content);
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    const error = await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.MATERIALIZATION_FAILED,
    );
    expect(error.message).not.toContain(root);
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans staging and publishes nothing when verification detects altered bytes', async () => {
    const root = await temporaryRoot();
    let reads = 0;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      readFile: async (targetPath) => {
        reads += 1;
        const bytes = await NODE_WORKSPACE_FILE_SYSTEM.readFile(targetPath);
        return reads === 1 ? Buffer.concat([bytes, Buffer.from('tampered')]) : bytes;
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans staging and publishes nothing when the atomic rename fails', async () => {
    const root = await temporaryRoot();
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      rename: async () => {
        throw Object.assign(new Error('injected'), { code: 'EIO' });
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.MATERIALIZATION_FAILED,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('maps an atomic destination race to a no-overwrite conflict', async () => {
    const root = await temporaryRoot();
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      rename: async () => {
        throw Object.assign(new Error('injected race'), { code: 'EEXIST' });
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.WORKSPACE_ALREADY_EXISTS,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects a staging directory returned outside the trusted root', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      mkdtemp: async () => outside,
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects unexpected staged files before commit', async () => {
    const root = await temporaryRoot();
    let injected = false;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      writeFile: async (targetPath, content) => {
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(targetPath, content);
        if (!injected) {
          injected = true;
          await NODE_WORKSPACE_FILE_SYSTEM.writeFile(
            path.join(path.dirname(targetPath), 'unexpected.txt'),
            'unexpected',
          );
        }
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects an injected staging symlink and does not publish a workspace', async () => {
    const root = await temporaryRoot();
    const externalFile = path.join(root, 'external.txt');
    await NODE_WORKSPACE_FILE_SYSTEM.writeFile(externalFile, 'external');
    let injected = false;
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      writeFile: async (targetPath, content) => {
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(targetPath, content);
        if (!injected) {
          injected = true;
          await NODE_WORKSPACE_FILE_SYSTEM.rm(targetPath);
          await symlink(externalFile, targetPath);
        }
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );
    expect(await readFile(externalFile, 'utf8')).toBe('external');
    expect((await readdir(root)).filter((entry) => entry !== 'external.txt')).toEqual([]);
  });

  it('removes the published directory if post-rename verification detects corruption', async () => {
    const root = await temporaryRoot();
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      rename: async (source, destination) => {
        await NODE_WORKSPACE_FILE_SYSTEM.rename(source, destination);
        const target = path.join(destination, 'src/index.ts');
        await NODE_WORKSPACE_FILE_SYSTEM.rm(target);
        await NODE_WORKSPACE_FILE_SYSTEM.writeFile(target, 'tampered');
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.VERIFICATION_FAILED,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it('rejects a symlink root and a non-directory root', async () => {
    const root = await temporaryRoot();
    const realRoot = path.join(root, 'real');
    const linkRoot = path.join(root, 'link');
    await mkdir(realRoot);
    await symlink(realRoot, linkRoot);
    const linked = createFilesystemControlledWorkspace({ rootPath: linkRoot });
    const plan = linked.plan(createWorkspacePlanRequestFixture());
    await expectControlledRejection(
      linked.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.SYMLINK_NOT_ALLOWED,
    );

    const fileRoot = path.join(root, 'file-root');
    await NODE_WORKSPACE_FILE_SYSTEM.writeFile(fileRoot, 'text');
    const invalid = createFilesystemControlledWorkspace({ rootPath: fileRoot });
    const invalidPlan = invalid.plan(createWorkspacePlanRequestFixture());
    await expectControlledRejection(
      invalid.materialize(invalidPlan),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
    );
  });

  it('sanitizes a root filesystem failure', async () => {
    const root = await temporaryRoot();
    const fileSystem: WorkspaceFileSystem = {
      ...NODE_WORKSPACE_FILE_SYSTEM,
      lstat: async () => {
        throw Object.assign(new Error(`denied ${root}`), { code: 'EACCES' });
      },
    };
    const workspace = createFilesystemControlledWorkspaceWithDependencies(
      { rootPath: root },
      { fileSystem },
    );
    const plan = workspace.plan(createWorkspacePlanRequestFixture());

    const error = await expectControlledRejection(
      workspace.materialize(plan),
      CONTROLLED_WORKSPACE_ERROR_CODES.INVALID_ROOT,
    );
    expect(error.message).not.toContain(root);
    expect(error.sourceCode).toBe('EACCES');
  });

  it('requires a host-owned absolute normalized root', () => {
    expect(() => createFilesystemControlledWorkspace({ rootPath: 'relative/output' })).toThrowError(
      ControlledWorkspaceError,
    );
    expect(() =>
      createFilesystemControlledWorkspace({ rootPath: '/tmp/../tmp/output' }),
    ).toThrowError(ControlledWorkspaceError);
    expect(() => createFilesystemControlledWorkspace({ rootPath: '/' })).toThrowError(
      ControlledWorkspaceError,
    );
  });

  it('logs only sanitized metadata and deterministic hashes', async () => {
    const root = await temporaryRoot();
    const records: Array<{ event: string; context?: Record<string, unknown> }> = [];
    const record = (event: string, context?: Record<string, unknown>) =>
      records.push(context === undefined ? { event } : { event, context });
    const logger: Logger = { debug: record, info: record, warn: record, error: record };
    let time = 100;
    const workspace = createFilesystemControlledWorkspace({
      rootPath: root,
      logger,
      now: () => time++,
    });
    const request = createWorkspacePlanRequestFixture();
    const plan = workspace.plan(request);
    await workspace.materialize(plan);

    expect(records.map((record) => record.event)).toEqual([
      'controlled_workspace.plan.created',
      'controlled_workspace.materialization.started',
      'controlled_workspace.materialization.completed',
    ]);
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain('src/index.ts');
    expect(serialized).not.toContain('export const ready');
    expect(serialized).toContain(plan.metadata.planHash);
  });

  it('keeps plan and materialization outcomes independent from logger failures', async () => {
    const root = await temporaryRoot();
    const throwing = () => {
      throw new Error('sink unavailable');
    };
    const logger: Logger = { debug: throwing, info: throwing, warn: throwing, error: throwing };
    const workspace = createFilesystemControlledWorkspace({ rootPath: root, logger });

    const plan = workspace.plan(createWorkspacePlanRequestFixture());
    const result = await workspace.materialize(plan);

    expect(result.workspaceId).toBe(plan.workspaceId);
    expect(await readFile(path.join(root, result.workspaceId, 'package.json'), 'utf8')).toContain(
      'generated-app',
    );
  });

  it('does not depend on shell or network execution primitives', async () => {
    const sources = await Promise.all(
      ['atomic-materializer.ts', 'file-system.ts', 'filesystem-controlled-workspace.ts'].map(
        (file) => readFile(new URL(file, import.meta.url), 'utf8'),
      ),
    );
    expect(sources.join('\n')).not.toMatch(
      /node:child_process|node:http|node:https|\bfetch\s*\(|\bexec\s*\(|\bspawn\s*\(/u,
    );
  });
});

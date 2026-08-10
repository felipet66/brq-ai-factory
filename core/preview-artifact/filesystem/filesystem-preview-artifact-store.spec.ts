import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
} from '../testing';
import { approvePreviewArtifact } from '../artifact';
import { createFilesystemPreviewArtifactStore } from './filesystem-preview-artifact-store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) =>
        import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })),
      ),
  );
});

async function root(): Promise<string> {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'brq-preview-artifact-test-'));
  roots.push(parent);
  return path.join(parent, 'private-store');
}

describe('FilesystemPreviewArtifactStore', () => {
  it('publishes atomically with private permissions and revalidates on read', async () => {
    const rootPath = await root();
    const store = createFilesystemPreviewArtifactStore({ rootPath });
    const candidate = createPreviewArtifactCandidateFixture();
    await store.stage(candidate);
    expect(await store.stage(candidate)).toMatchObject({
      artifactId: candidate.artifactId,
      status: 'CANDIDATE',
    });
    expect((await lstat(rootPath)).mode & 0o777).toBe(0o700);
    const storedPath = path.join(rootPath, `${candidate.artifactId}.json`);
    expect((await lstat(storedPath)).mode & 0o777).toBe(0o600);
    const approved = createApprovedPreviewArtifactFixture();
    await store.approve(approved);
    expect(await store.readApproved(approved.artifactId)).toEqual(approved);
    expect((await readFile(storedPath, 'utf8')).includes('BRQ Preview')).toBe(true);
    expect((await store.consume(approved.artifactId, '2026-08-10T12:02:00.000Z')).status).toBe(
      'CONSUMED',
    );
    expect(await store.readApproved(approved.artifactId)).toBeNull();
    const deleted = await store.remove(approved.artifactId, '2026-08-10T12:03:00.000Z');
    expect(deleted?.status).toBe('DELETED');
    expect(await store.remove(approved.artifactId, '2026-08-10T12:04:00.000Z')).toEqual(deleted);
  });

  it('rejects a non-candidate at the filesystem staging boundary', async () => {
    const rootPath = await root();
    const store = createFilesystemPreviewArtifactStore({ rootPath });

    await expect(
      store.stage(createApprovedPreviewArtifactFixture() as never),
    ).rejects.toBeDefined();
  });

  it('keeps an existing approval immutable across idempotent filesystem calls', async () => {
    const store = createFilesystemPreviewArtifactStore({ rootPath: await root() });
    const candidate = createPreviewArtifactCandidateFixture();
    const approved = createApprovedPreviewArtifactFixture();
    const divergent = approvePreviewArtifact({
      candidate,
      factoryStatus: 'SUCCESS',
      sandboxStatus: 'SUCCESS',
      workspaceReleaseStatus: 'RELEASED',
      factoryResultHash: 'e'.repeat(64),
      sandboxResultHash: approved.approval!.sandboxResultHash,
      sandboxRequestHash: candidate.source.sandboxRequestHash,
      workspaceHash: candidate.source.workspaceHash,
      approvedAt: approved.approval!.approvedAt,
    });

    await store.stage(candidate);
    await store.approve(approved);
    await expect(store.approve(approved)).resolves.toMatchObject({
      hashes: { approvalHash: approved.hashes.approvalHash },
    });
    await expect(store.approve(divergent)).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_INTEGRITY_MISMATCH',
    });
    await expect(store.readApproved(approved.artifactId)).resolves.toEqual(approved);
  });

  it('rejects symlink tampering and unsafe roots', async () => {
    expect(() => createFilesystemPreviewArtifactStore({ rootPath: 'relative' })).toThrow();
    expect(() =>
      createFilesystemPreviewArtifactStore({ rootPath: path.parse(process.cwd()).root }),
    ).toThrow();
    const rootPath = await root();
    const store = createFilesystemPreviewArtifactStore({ rootPath });
    const candidate = createPreviewArtifactCandidateFixture();
    await store.stage(candidate);
    const location = path.join(rootPath, `${candidate.artifactId}.json`);
    await import('node:fs/promises').then(({ rm }) => rm(location));
    await symlink('/etc/hosts', location);
    await expect(store.readApproved(candidate.artifactId)).rejects.toBeDefined();
    await chmod(rootPath, 0o755);
  });

  it('fails closed for invalid transitions, missing candidates and serialized tampering', async () => {
    const rootPath = await root();
    const store = createFilesystemPreviewArtifactStore({ rootPath });
    const candidate = createPreviewArtifactCandidateFixture();
    const approved = createApprovedPreviewArtifactFixture();
    await expect(store.approve(approved)).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_NOT_FOUND',
    });
    await store.stage(candidate);
    expect((await store.expire(candidate.artifactId, candidate.expiresAt)).status).toBe('EXPIRED');
    await expect(store.expire(candidate.artifactId, candidate.expiresAt)).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_INVALID_TRANSITION',
    });
    await expect(
      store.consume('preview-artifact-00000000000000000000000000000000', candidate.createdAt),
    ).rejects.toMatchObject({ code: 'PREVIEW_ARTIFACT_NOT_FOUND' });

    const secondRoot = await root();
    const secondStore = createFilesystemPreviewArtifactStore({ rootPath: secondRoot });
    await secondStore.stage(candidate);
    const location = path.join(secondRoot, `${candidate.artifactId}.json`);
    await writeFile(location, '{"tampered":true}', { mode: 0o600 });
    await expect(secondStore.readApproved(candidate.artifactId)).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_INTEGRITY_MISMATCH',
    });
  });

  it('rejects a symlink used as the configured store root', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'brq-preview-root-link-test-'));
    roots.push(parent);
    const target = path.join(parent, 'target');
    const linkedRoot = path.join(parent, 'linked');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linkedRoot);
    const store = createFilesystemPreviewArtifactStore({ rootPath: linkedRoot });
    await expect(store.stage(createPreviewArtifactCandidateFixture())).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_STORE_FAILURE',
    });
  });

  it('rejects an existing broad-permission root without changing its permissions', async () => {
    const rootPath = await root();
    await mkdir(rootPath, { mode: 0o755 });
    await chmod(rootPath, 0o755);
    const store = createFilesystemPreviewArtifactStore({ rootPath });

    await expect(store.stage(createPreviewArtifactCandidateFixture())).rejects.toMatchObject({
      code: 'PREVIEW_ARTIFACT_STORE_FAILURE',
    });
    expect((await lstat(rootPath)).mode & 0o777).toBe(0o755);
  });
});

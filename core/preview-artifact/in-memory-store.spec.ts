import { describe, expect, it } from 'vitest';

import { approvePreviewArtifact } from './artifact';
import { PREVIEW_ARTIFACT_ERROR_CODES } from './errors';
import { createInMemoryPreviewArtifactContentStore } from './in-memory-store';
import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
} from './testing/preview-artifact-fixtures';

describe('InMemoryPreviewArtifactContentStore', () => {
  it('enforces stage, approval, single consumption and idempotent removal', async () => {
    const store = createInMemoryPreviewArtifactContentStore();
    const candidate = createPreviewArtifactCandidateFixture();
    expect((await store.stage(candidate)).status).toBe('CANDIDATE');
    expect((await store.stage(candidate)).artifactId).toBe(candidate.artifactId);
    const approved = createApprovedPreviewArtifactFixture();
    expect((await store.approve(approved)).status).toBe('APPROVED');
    expect(await store.readApproved(approved.artifactId)).toEqual(approved);
    const consumed = await store.consume(approved.artifactId, '2026-08-10T12:02:00.000Z');
    expect(consumed.status).toBe('CONSUMED');
    expect(await store.readApproved(approved.artifactId)).toBeNull();
    await expect(
      store.consume(approved.artifactId, '2026-08-10T12:03:00.000Z'),
    ).rejects.toMatchObject({
      code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
    });
    await expect(store.approve(approved)).rejects.toMatchObject({
      code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_TRANSITION,
    });
    const deleted = await store.remove(approved.artifactId, '2026-08-10T12:04:00.000Z');
    expect(deleted?.status).toBe('DELETED');
    expect(await store.remove(approved.artifactId, '2026-08-10T12:05:00.000Z')).toEqual(deleted);
  });

  it('rejects a non-candidate at the staging boundary', async () => {
    const store = createInMemoryPreviewArtifactContentStore();

    await expect(
      store.stage(createApprovedPreviewArtifactFixture() as never),
    ).rejects.toBeDefined();
  });

  it('keeps an existing approval idempotent and rejects divergent reapproval', async () => {
    const store = createInMemoryPreviewArtifactContentStore();
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
      artifactId: approved.artifactId,
      hashes: { approvalHash: approved.hashes.approvalHash },
    });
    await expect(store.approve(divergent)).rejects.toMatchObject({
      code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
    });
    await expect(store.readApproved(approved.artifactId)).resolves.toEqual(approved);
  });

  it('rejects approval tampering, supports expiration and propagates abort', async () => {
    const store = createInMemoryPreviewArtifactContentStore();
    const candidate = createPreviewArtifactCandidateFixture();
    await store.stage(candidate);
    const divergentCandidate = {
      ...candidate,
      hashes: { ...candidate.hashes, artifactHash: 'f'.repeat(64) },
    };
    expect(() =>
      approvePreviewArtifact({
        candidate: { ...divergentCandidate, artifactId: `preview-artifact-${'f'.repeat(32)}` },
        factoryStatus: 'SUCCESS',
        sandboxStatus: 'SUCCESS',
        workspaceReleaseStatus: 'RELEASED',
        factoryResultHash: 'c'.repeat(64),
        sandboxResultHash: 'd'.repeat(64),
        sandboxRequestHash: 'b'.repeat(64),
        workspaceHash: 'a'.repeat(64),
        approvedAt: '2026-08-10T12:00:10.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_INPUT }));
    expect((await store.expire(candidate.artifactId, '2026-08-10T12:31:00.000Z')).status).toBe(
      'EXPIRED',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      store.readApproved(candidate.artifactId, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: PREVIEW_ARTIFACT_ERROR_CODES.STORE_FAILURE,
    });
    expect(
      await store.remove(
        'preview-artifact-00000000000000000000000000000000',
        '2026-08-10T12:32:00.000Z',
      ),
    ).toBeNull();
    await expect(
      store.expire('preview-artifact-00000000000000000000000000000000', '2026-08-10T12:32:00.000Z'),
    ).rejects.toMatchObject({ code: PREVIEW_ARTIFACT_ERROR_CODES.NOT_FOUND });
  });
});

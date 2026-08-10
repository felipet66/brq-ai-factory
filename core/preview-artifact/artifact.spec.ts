import { describe, expect, it } from 'vitest';

import {
  approvePreviewArtifact,
  createPreviewArtifactCandidate,
  projectApprovedPreviewArtifactDescriptor,
} from './artifact';
import { PREVIEW_ARTIFACT_ERROR_CODES, PreviewArtifactError } from './errors';
import {
  calculatePreviewArtifactApprovalHash,
  calculatePreviewArtifactContentHash,
} from './hashing';
import { approvedPreviewArtifactSchema, previewArtifactCandidateSchema } from './schemas';
import {
  createApprovedPreviewArtifactFixture,
  createPreviewArtifactCandidateFixture,
  createPreviewArtifactFilesFixture,
} from './testing/preview-artifact-fixtures';

describe('PreviewArtifact contracts', () => {
  it('creates a deterministic, canonical and immutable candidate', () => {
    const first = createPreviewArtifactCandidateFixture();
    const reversed = createPreviewArtifactCandidate({
      executionId: first.source.executionId,
      workspaceHash: first.source.workspaceHash,
      sandboxRequestHash: first.source.sandboxRequestHash,
      profileId: 'NODE_WEB_PREVIEW_24_V1',
      exporterVersion: '1.0.0',
      createdAt: first.createdAt,
      expiresAt: first.expiresAt,
      files: [...createPreviewArtifactFilesFixture()].reverse(),
    });
    expect(reversed).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.files)).toBe(true);
    expect(first.files.map((file) => file.path)).toEqual([
      'assets/app.css',
      'assets/app.js',
      'index.html',
    ]);
    expect(first.hashes.artifactContentHash).toBe(calculatePreviewArtifactContentHash(first.files));
    expect(previewArtifactCandidateSchema.parse(first)).toEqual(first);
  });

  it('binds approval to Factory, Sandbox, Workspace and exact artifact hashes', () => {
    const approved = createApprovedPreviewArtifactFixture();
    expect(approved.status).toBe('APPROVED');
    expect(approved.hashes.approvalHash).toBe(
      calculatePreviewArtifactApprovalHash({
        artifactId: approved.artifactId,
        artifactHash: approved.hashes.artifactHash,
        artifactContentHash: approved.hashes.artifactContentHash,
        executionId: approved.source.executionId,
        workspaceHash: approved.source.workspaceHash,
        sandboxRequestHash: approved.source.sandboxRequestHash,
        sandboxResultHash: approved.approval!.sandboxResultHash,
        factoryResultHash: approved.approval!.factoryResultHash,
      }),
    );
    const descriptor = projectApprovedPreviewArtifactDescriptor(approved);
    expect(descriptor).not.toHaveProperty('files');
    expect(approvedPreviewArtifactSchema.parse(approved)).toEqual(approved);
  });

  it('fails closed for expired approval and tampering', () => {
    expect(() =>
      approvePreviewArtifact({
        candidate: createPreviewArtifactCandidateFixture(),
        factoryStatus: 'SUCCESS',
        sandboxStatus: 'SUCCESS',
        workspaceReleaseStatus: 'RELEASED',
        factoryResultHash: 'c'.repeat(64),
        sandboxResultHash: 'd'.repeat(64),
        sandboxRequestHash: 'b'.repeat(64),
        workspaceHash: 'a'.repeat(64),
        approvedAt: '2026-08-10T12:30:00.000Z',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PREVIEW_ARTIFACT_ERROR_CODES.EXPIRED,
      }) as PreviewArtifactError,
    );
    expect(() =>
      approvePreviewArtifact({
        candidate: createPreviewArtifactCandidateFixture(),
        factoryStatus: 'SUCCESS',
        sandboxStatus: 'SUCCESS',
        workspaceReleaseStatus: 'RELEASED',
        factoryResultHash: 'c'.repeat(64),
        sandboxResultHash: 'd'.repeat(64),
        sandboxRequestHash: 'b'.repeat(64),
        workspaceHash: 'e'.repeat(64),
        approvedAt: '2026-08-10T12:01:00.000Z',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PREVIEW_ARTIFACT_ERROR_CODES.INTEGRITY_MISMATCH,
      }) as PreviewArtifactError,
    );
    const approved = createApprovedPreviewArtifactFixture();
    expect(
      approvedPreviewArtifactSchema.safeParse({
        ...approved,
        files: approved.files.map((file, index) =>
          index === 0 ? { ...file, content: `${file.content}tampered` } : file,
        ),
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      name: 'missing index',
      files: createPreviewArtifactFilesFixture().filter((file) => file.path !== 'index.html'),
    },
    {
      name: 'traversal',
      files: [
        ...createPreviewArtifactFilesFixture(),
        { path: '../escape.js', mediaType: 'text/javascript' as const, content: 'void 0;' },
      ],
    },
    {
      name: 'portable collision',
      files: [
        ...createPreviewArtifactFilesFixture(),
        { path: 'INDEX.HTML', mediaType: 'text/html' as const, content: '<p>collision</p>' },
      ],
    },
    {
      name: 'secret',
      files: [
        ...createPreviewArtifactFilesFixture(),
        {
          path: 'secret.js',
          mediaType: 'text/javascript' as const,
          content: "const api_key = 'sk-123456789012345678901234567890';",
        },
      ],
    },
  ])('rejects $name without truncation', ({ files }) => {
    expect(() =>
      createPreviewArtifactCandidate({
        executionId: 'execution-preview-fixture-001',
        workspaceHash: 'a'.repeat(64),
        sandboxRequestHash: 'b'.repeat(64),
        profileId: 'NODE_WEB_PREVIEW_24_V1',
        exporterVersion: '1.0.0',
        createdAt: '2026-08-10T12:00:00.000Z',
        expiresAt: '2026-08-10T12:30:00.000Z',
        files,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PREVIEW_ARTIFACT_ERROR_CODES.INVALID_INPUT,
      }) as PreviewArtifactError,
    );
  });
});

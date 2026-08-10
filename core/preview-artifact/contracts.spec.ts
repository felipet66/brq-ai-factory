import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { canTransitionPreviewArtifact } from './lifecycle';
import { logPreviewArtifactEvent, previewArtifactLogContext } from './logging';
import {
  approvedPreviewArtifactDescriptorSchema,
  previewArtifactExportEnvelopeSchema,
} from './schemas';
import { createApprovedPreviewArtifactFixture, createPreviewArtifactFilesFixture } from './testing';
import { projectApprovedPreviewArtifactDescriptor } from './artifact';

describe('PreviewArtifact public boundary', () => {
  it('accepts only the strict versioned export envelope', () => {
    const envelope = {
      abiVersion: '1.0.0',
      profileId: 'NODE_WEB_PREVIEW_24_V1',
      exporterVersion: '1.0.0',
      files: createPreviewArtifactFilesFixture(),
    };
    expect(previewArtifactExportEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(
      previewArtifactExportEnvelopeSchema.safeParse({ ...envelope, command: 'npm start' }).success,
    ).toBe(false);
    expect(
      previewArtifactExportEnvelopeSchema.safeParse({ ...envelope, profileId: 'FLEXIBLE' }).success,
    ).toBe(false);
  });

  it('keeps lifecycle fail-closed and descriptors content-free', () => {
    expect(canTransitionPreviewArtifact('CANDIDATE', 'APPROVED')).toBe(true);
    expect(canTransitionPreviewArtifact('APPROVED', 'CANDIDATE')).toBe(false);
    expect(canTransitionPreviewArtifact('DELETED', 'APPROVED')).toBe(false);
    const descriptor = projectApprovedPreviewArtifactDescriptor(
      createApprovedPreviewArtifactFixture(),
    );
    expect(approvedPreviewArtifactDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(descriptor).not.toHaveProperty('files');
  });

  it('logs only safe descriptor metadata', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const descriptor = projectApprovedPreviewArtifactDescriptor(
      createApprovedPreviewArtifactFixture(),
    );
    logPreviewArtifactEvent(
      logger,
      'info',
      'preview.artifact.approved',
      previewArtifactLogContext(descriptor),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(descriptor.hashes.artifactHash);
    expect(lines[0]).not.toMatch(/BRQ Preview|index\.html|doctype|<script/iu);
    expect(() =>
      logPreviewArtifactEvent(
        createLogger({
          sink: () => {
            throw new Error('sink');
          },
        }),
        'info',
        'preview.artifact.approved',
        {},
      ),
    ).not.toThrow();
  });
});

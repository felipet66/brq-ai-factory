import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import { PREVIEW_ARTIFACT_CONTRACT_VERSION, PREVIEW_ARTIFACT_VERSION } from './version';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function domainHash(domain: string, value: unknown): string {
  return sha256(`${domain}\u0000${canonicalJson(value)}`);
}

export interface PreviewArtifactHashFile {
  readonly path: string;
  readonly encoding: 'UTF-8';
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentHash: string;
}

export function calculatePreviewArtifactFileContentHash(content: string): string {
  return sha256(Buffer.from(content, 'utf8'));
}

function orderedFiles(
  files: readonly PreviewArtifactHashFile[],
): readonly PreviewArtifactHashFile[] {
  return [...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => ({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    }));
}

export function calculatePreviewArtifactContentHash(
  files: readonly PreviewArtifactHashFile[],
): string {
  return domainHash('brq-preview-artifact:content:v1', orderedFiles(files));
}

export function calculatePreviewArtifactHash(input: {
  readonly profileId: string;
  readonly exporterVersion: string;
  readonly source: {
    readonly executionId: string;
    readonly workspaceHash: string;
    readonly sandboxRequestHash: string;
  };
  readonly files: readonly PreviewArtifactHashFile[];
  readonly artifactContentHash: string;
}): string {
  return domainHash('brq-preview-artifact:artifact:v1', {
    artifactVersion: PREVIEW_ARTIFACT_VERSION,
    contractVersion: PREVIEW_ARTIFACT_CONTRACT_VERSION,
    profileId: input.profileId,
    exporterVersion: input.exporterVersion,
    source: input.source,
    files: orderedFiles(input.files),
    artifactContentHash: input.artifactContentHash,
  });
}

export function derivePreviewArtifactId(artifactHash: string): string {
  return `preview-artifact-${artifactHash.slice(0, 32)}`;
}

export function calculatePreviewArtifactApprovalHash(input: {
  readonly artifactId: string;
  readonly artifactHash: string;
  readonly artifactContentHash: string;
  readonly executionId: string;
  readonly workspaceHash: string;
  readonly sandboxRequestHash: string;
  readonly sandboxResultHash: string;
  readonly factoryResultHash: string;
}): string {
  return domainHash('brq-preview-artifact:approval:v1', {
    contractVersion: PREVIEW_ARTIFACT_CONTRACT_VERSION,
    factoryStatus: 'SUCCESS',
    sandboxStatus: 'SUCCESS',
    workspaceReleaseStatus: 'RELEASED',
    ...input,
  });
}

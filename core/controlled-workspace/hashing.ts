import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json';
import type { ControlledWorkspaceLimits } from './limits';
import { CONTROLLED_WORKSPACE_CONTRACT_VERSION, CONTROLLED_WORKSPACE_VERSION } from './version';

interface WorkspaceSourceHashesValue {
  readonly technicalSpecificationHash: string;
  readonly generationHash: string;
  readonly bundleHash: string;
  readonly bundleContentHash: string;
  readonly bundleVersion: string;
  readonly contractVersion: string;
}

interface WorkspaceFileMetadataValue {
  readonly path: string;
  readonly encoding: 'UTF-8';
  readonly mediaType: string;
  readonly purpose: string;
  readonly byteLength: number;
  readonly contentHash: string;
  readonly structuralHash: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function domainHash(domain: string, value: unknown): string {
  return sha256(`${domain}\u0000${canonicalJson(value)}`);
}

export interface WorkspaceBundleContentFileValue {
  readonly path: string;
  readonly encoding: 'UTF-8';
  readonly mediaType: string;
  readonly purpose: string;
  readonly byteLength: number;
  readonly contentHash: string;
}

export function calculateWorkspaceBundleContentHash(
  files: readonly WorkspaceBundleContentFileValue[],
): string {
  const ordered = [...files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => ({
      path: file.path,
      encoding: file.encoding,
      mediaType: file.mediaType,
      purpose: file.purpose,
      byteLength: file.byteLength,
      contentHash: file.contentHash,
    }));
  return sha256(`brq.code-bundle-content.v1\n${canonicalJson(ordered)}`);
}

export function calculateWorkspaceContentHash(content: string): string {
  return sha256(Buffer.from(content, 'utf8'));
}

export function calculateWorkspaceFileStructuralHash(
  file: Omit<WorkspaceFileMetadataValue, 'structuralHash'>,
): string {
  return domainHash('brq-controlled-workspace:file:v1', file);
}

export function calculateWorkspacePlanHash(input: {
  readonly source: WorkspaceSourceHashesValue;
  readonly files: readonly WorkspaceFileMetadataValue[];
  readonly policyHash: string;
  readonly configurationHash: string;
}): string {
  return domainHash('brq-controlled-workspace:plan:v1', {
    contractVersion: CONTROLLED_WORKSPACE_CONTRACT_VERSION,
    source: input.source,
    files: input.files,
    policyHash: input.policyHash,
    configurationHash: input.configurationHash,
  });
}

export function calculateWorkspaceConfigurationHash(limits: ControlledWorkspaceLimits): string {
  return domainHash('brq-controlled-workspace:configuration:v1', limits);
}

export function calculateWorkspacePolicyHash(limits: ControlledWorkspaceLimits): string {
  return domainHash('brq-controlled-workspace:policy:v1', {
    workspaceVersion: CONTROLLED_WORKSPACE_VERSION,
    contractVersion: CONTROLLED_WORKSPACE_CONTRACT_VERSION,
    pathPolicyVersion: '1.0.0',
    contentPolicyVersion: '1.0.0',
    limits,
  });
}

export function deriveWorkspaceId(planHash: string): string {
  return `workspace-${planHash.slice(0, 32)}`;
}

export function calculateMaterializedWorkspaceHash(input: {
  readonly workspaceId: string;
  readonly planHash: string;
  readonly source: WorkspaceSourceHashesValue;
  readonly files: readonly WorkspaceFileMetadataValue[];
  readonly policyHash: string;
  readonly configurationHash: string;
}): string {
  return domainHash('brq-controlled-workspace:materialized:v1', {
    workspaceVersion: CONTROLLED_WORKSPACE_VERSION,
    contractVersion: CONTROLLED_WORKSPACE_CONTRACT_VERSION,
    ...input,
  });
}

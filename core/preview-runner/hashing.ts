import { createHash } from 'node:crypto';

import type { ApprovedPreviewArtifactDescriptor } from '@brq/preview-artifact';

import { canonicalJson } from './canonical-json';
import type { PreviewLimits } from './limits';
import type { PreviewPolicy } from './policies';
import { PREVIEW_RUNNER_CONTRACT_VERSION, PREVIEW_RUNNER_VERSION } from './version';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function domainHash(domain: string, value: unknown): string {
  return sha256(`${domain}\u0000${canonicalJson(value)}`);
}

export function calculatePreviewPolicyHash(policy: PreviewPolicy): string {
  return domainHash('brq-preview-runner:policy:v1', {
    runnerVersion: PREVIEW_RUNNER_VERSION,
    contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
    policy,
  });
}

export function calculatePreviewLimitsHash(limits: PreviewLimits): string {
  return domainHash('brq-preview-runner:limits:v1', limits);
}

export function calculatePreviewRequestHash(input: {
  readonly executionId: string;
  readonly artifact: ApprovedPreviewArtifactDescriptor;
  readonly policyId: string;
  readonly policyHash: string;
  readonly effectiveLimits: PreviewLimits;
}): string {
  return domainHash('brq-preview-runner:request:v1', {
    contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
    executionId: input.executionId,
    artifactId: input.artifact.artifactId,
    artifactHash: input.artifact.hashes.artifactHash,
    artifactApprovalHash: input.artifact.hashes.approvalHash,
    factoryResultHash: input.artifact.approval?.factoryResultHash,
    sandboxResultHash: input.artifact.approval?.sandboxResultHash,
    workspaceHash: input.artifact.source.workspaceHash,
    policyId: input.policyId,
    policyHash: input.policyHash,
    effectiveLimits: input.effectiveLimits,
  });
}

export function derivePreviewId(previewRequestHash: string): string {
  return `preview-${previewRequestHash.slice(0, 32)}`;
}

export function calculatePreviewLineageHash(input: {
  readonly executionId: string;
  readonly artifactId: string;
  readonly factoryResultHash: string;
  readonly sandboxRequestHash: string;
  readonly sandboxResultHash: string;
  readonly workspaceHash: string;
  readonly artifactHash: string;
  readonly artifactApprovalHash: string;
}): string {
  return domainHash('brq-preview-runner:lineage:v1', input);
}

export function calculatePreviewProvenanceHash(value: unknown): string {
  return domainHash('brq-preview-runner:provenance:v1', value);
}

export function calculatePreviewSessionHash(input: {
  readonly previewId: string;
  readonly executionId: string;
  readonly artifactId: string;
  readonly previewRequestHash: string;
  readonly policyHash: string;
  readonly limitsHash: string;
  readonly lineageHash: string;
}): string {
  return domainHash('brq-preview-runner:session:v1', {
    runnerVersion: PREVIEW_RUNNER_VERSION,
    contractVersion: PREVIEW_RUNNER_CONTRACT_VERSION,
    ...input,
  });
}

export function calculatePreviewRuntimeHash(input: unknown): string {
  return domainHash('brq-preview-runner:runtime:v1', input);
}

import { createHash } from 'node:crypto';

import type { ArtifactDraft } from '@brq/shared/types/artifact';
import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson } from './canonical-json';
import type { ArtifactSpecification, ArtifactTemplate, GeneratedArtifact } from './contracts';

export function calculateStructuralHash(value: JsonValue): string {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex');
}

export function calculateSpecificationHash(specification: ArtifactSpecification): string {
  return calculateStructuralHash(specification as unknown as JsonValue);
}

export function calculateTemplateHash(template: ArtifactTemplate): string {
  return calculateStructuralHash(template as unknown as JsonValue);
}

export function calculateDraftHash(draft: ArtifactDraft): string {
  return calculateStructuralHash(draft as unknown as JsonValue);
}

export function calculateGenerationHash(input: {
  readonly specificationHash: string;
  readonly sourceValidationHash: string;
  readonly sourceValidatedValueHash: string;
  readonly artifacts: readonly GeneratedArtifact[];
}): string {
  return calculateStructuralHash({
    specificationHash: input.specificationHash,
    sourceValidationHash: input.sourceValidationHash,
    sourceValidatedValueHash: input.sourceValidatedValueHash,
    artifacts: input.artifacts.map((artifact) => ({
      templateId: artifact.metadata.templateId,
      templateHash: artifact.metadata.templateHash,
      contentHash: artifact.metadata.contentHash,
      draftHash: artifact.metadata.draftHash,
      byteLength: artifact.metadata.byteLength,
    })),
  });
}

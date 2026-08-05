import {
  ARTIFACT_GENERATOR_ERROR_CODES,
  artifactGenerationRequestSchema,
  artifactMediaTypeSchema,
  createArtifactGenerator,
  DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION,
} from '@brq/artifact-generator';
import type {
  ArtifactBinding,
  ArtifactGenerationResult,
  ArtifactMediaType,
} from '@brq/artifact-generator';
import { describe, expect, it } from 'vitest';

import { createArtifactGenerationRequest } from './testing/artifact-generator-fixtures';

describe('@brq/artifact-generator package exports', () => {
  it('exposes the generic public API and canonical contracts', () => {
    const binding: ArtifactBinding = { id: 'root', path: [] };
    const mediaType: ArtifactMediaType = 'application/json';
    const result: ArtifactGenerationResult = createArtifactGenerator().generate(
      createArtifactGenerationRequest(),
    );

    expect(binding.path).toEqual([]);
    expect(artifactMediaTypeSchema.parse(mediaType)).toBe(mediaType);
    expect(
      artifactGenerationRequestSchema.safeParse(createArtifactGenerationRequest()).success,
    ).toBe(true);
    expect(result.metadata.artifactCount).toBe(2);
    expect(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxArtifacts).toBe(16);
    expect(ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND).toContain('BINDING_NOT_FOUND');
  });
});

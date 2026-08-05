import { describe, expect, it } from 'vitest';

import {
  artifactGeneratorConfigurationSchema,
  DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION,
  resolveArtifactGeneratorConfiguration,
} from './configuration';
import { ARTIFACT_GENERATOR_ERROR_CODES } from './errors';

describe('Artifact Generator configuration', () => {
  it('uses centralized immutable defaults', () => {
    const configuration = resolveArtifactGeneratorConfiguration(undefined);

    expect(configuration).toEqual(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION);
    expect(configuration).toEqual({
      maxArtifacts: 16,
      maxFragmentsPerArtifact: 256,
      maxBindingsPerArtifact: 64,
      maxBindingPathDepth: 32,
      maxSpecificationBytes: 256 * 1024,
      maxArtifactBytes: 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
      maxNestingDepth: 100,
    });
    expect(Object.isFrozen(configuration)).toBe(true);
  });

  it('fills omitted fields without mutating a valid partial configuration', () => {
    const input = { maxArtifacts: 2 };
    const configuration = resolveArtifactGeneratorConfiguration(input);

    expect(configuration.maxArtifacts).toBe(2);
    expect(configuration.maxArtifactBytes).toBe(
      DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxArtifactBytes,
    );
    expect(input).toEqual({ maxArtifacts: 2 });
  });

  it.each([
    { maxArtifacts: 0 },
    { maxFragmentsPerArtifact: 4_097 },
    { maxBindingsPerArtifact: 2_049 },
    { maxBindingPathDepth: 257 },
    { maxSpecificationBytes: 1024 * 1024 + 1 },
    { maxArtifactBytes: 17 * 1024 * 1024, maxTotalBytes: 17 * 1024 * 1024 },
    { maxNestingDepth: 513 },
    { unexpected: true },
  ])('rejects invalid or unknown configuration fields: %j', (configuration) => {
    expect(artifactGeneratorConfigurationSchema.safeParse(configuration).success).toBe(false);
  });

  it('rejects a per-artifact budget greater than the total budget with a canonical error', () => {
    expect(() =>
      resolveArtifactGeneratorConfiguration({ maxArtifactBytes: 2, maxTotalBytes: 1 }),
    ).toThrowError(
      expect.objectContaining({ code: ARTIFACT_GENERATOR_ERROR_CODES.INVALID_CONFIGURATION }),
    );
  });
});

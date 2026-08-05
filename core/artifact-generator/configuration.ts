import { z } from 'zod';

import { ARTIFACT_GENERATOR_ERROR_CODES, ArtifactGeneratorError } from './errors';

export const DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION = Object.freeze({
  maxArtifacts: 16,
  maxFragmentsPerArtifact: 256,
  maxBindingsPerArtifact: 64,
  maxBindingPathDepth: 32,
  maxSpecificationBytes: 256 * 1024,
  maxArtifactBytes: 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxNestingDepth: 100,
});

const ABSOLUTE_ARTIFACT_GENERATOR_LIMITS = Object.freeze({
  maxArtifacts: 256,
  maxFragmentsPerArtifact: 4_096,
  maxBindingsPerArtifact: 2_048,
  maxBindingPathDepth: 256,
  maxSpecificationBytes: 1024 * 1024,
  maxArtifactBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxNestingDepth: 512,
});

export const artifactGeneratorConfigurationSchema = z
  .object({
    maxArtifacts: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxArtifacts)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxArtifacts),
    maxFragmentsPerArtifact: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxFragmentsPerArtifact)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxFragmentsPerArtifact),
    maxBindingsPerArtifact: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxBindingsPerArtifact)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxBindingsPerArtifact),
    maxBindingPathDepth: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxBindingPathDepth)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxBindingPathDepth),
    maxSpecificationBytes: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxSpecificationBytes)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxSpecificationBytes),
    maxArtifactBytes: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxArtifactBytes)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxArtifactBytes),
    maxTotalBytes: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxTotalBytes)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxTotalBytes),
    maxNestingDepth: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_ARTIFACT_GENERATOR_LIMITS.maxNestingDepth)
      .default(DEFAULT_ARTIFACT_GENERATOR_CONFIGURATION.maxNestingDepth),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (configuration.maxArtifactBytes > configuration.maxTotalBytes) {
      context.addIssue({
        code: 'custom',
        message: 'maxArtifactBytes não pode superar maxTotalBytes.',
        path: ['maxArtifactBytes'],
      });
    }
  });

export type ArtifactGeneratorConfiguration = Readonly<
  z.infer<typeof artifactGeneratorConfigurationSchema>
>;

export function resolveArtifactGeneratorConfiguration(
  input: Partial<ArtifactGeneratorConfiguration> | undefined,
): ArtifactGeneratorConfiguration {
  const result = artifactGeneratorConfigurationSchema.safeParse(input ?? {});

  if (!result.success) {
    throw new ArtifactGeneratorError('Configuração do Artifact Generator inválida.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
      cause: result.error,
    });
  }

  return Object.freeze(result.data);
}

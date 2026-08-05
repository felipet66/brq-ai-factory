import type { JsonValue } from '@brq/shared/types/json-value';

import { canonicalizeJson, measureJsonNestingDepth } from './canonical-json';
import type { ArtifactGeneratorConfiguration } from './configuration';
import { calculateValidatedValueHash } from './content-hashing';
import type { ArtifactGenerationRequest, ArtifactTemplate } from './contracts';
import { ARTIFACT_GENERATOR_ERROR_CODES, ArtifactGeneratorError } from './errors';
import { artifactGenerationRequestSchema } from './schemas';

function failLimit(message: string, request: ArtifactGenerationRequest, durationMs: number): never {
  throw new ArtifactGeneratorError(message, {
    code: ARTIFACT_GENERATOR_ERROR_CODES.SPECIFICATION_LIMIT_EXCEEDED,
    stage: 'SPECIFICATION_VALIDATION',
    durationMs,
    specificationId: request.specification.id,
  });
}

function bindingCount(template: ArtifactTemplate): number {
  return template.bindings.length;
}

function bindingPaths(template: ArtifactTemplate): readonly (readonly (string | number)[])[] {
  return template.bindings.map((binding) => binding.path);
}

export function validateArtifactGenerationRequest(
  input: ArtifactGenerationRequest,
  durationMs: number,
): ArtifactGenerationRequest {
  const result = artifactGenerationRequestSchema.safeParse(input);
  if (!result.success) {
    throw new ArtifactGeneratorError('Solicitação do Artifact Generator inválida.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST_VALIDATION',
      durationMs,
      cause: result.error,
    });
  }

  return result.data as ArtifactGenerationRequest;
}

export function assertGenerationPreconditions(
  request: ArtifactGenerationRequest,
  configuration: ArtifactGeneratorConfiguration,
  durationMs: number,
): void {
  if (!request.validation.valid || request.validation.validatedOutput === null) {
    throw new ArtifactGeneratorError('Artifact generation exige ValidationResult válido.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_VALIDATION_REJECTED,
      stage: 'REQUEST_VALIDATION',
      durationMs,
      specificationId: request.specification.id,
    });
  }

  const validatedValueHash = calculateValidatedValueHash(request.validation.validatedOutput);
  if (
    request.validation.metadata.validatedValueHash === null ||
    request.validation.metadata.validatedValueHash !== validatedValueHash
  ) {
    throw new ArtifactGeneratorError('O hash do valor validado não corresponde à saída recebida.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_INTEGRITY_MISMATCH,
      stage: 'SOURCE_INTEGRITY_VALIDATION',
      durationMs,
      specificationId: request.specification.id,
    });
  }

  const expected = request.specification.sourceContract;
  const actual = request.validation.metadata.contract;
  if (
    expected.id !== actual.id ||
    expected.version !== actual.version ||
    expected.format !== actual.format ||
    expected.contractHash !== actual.contractHash
  ) {
    throw new ArtifactGeneratorError(
      'O contrato fonte da especificação não corresponde ao ValidationResult.',
      {
        code: ARTIFACT_GENERATOR_ERROR_CODES.SOURCE_CONTRACT_MISMATCH,
        stage: 'SPECIFICATION_VALIDATION',
        durationMs,
        specificationId: request.specification.id,
      },
    );
  }

  const specificationBytes = Buffer.byteLength(
    canonicalizeJson(request.specification as unknown as JsonValue),
    'utf8',
  );
  if (specificationBytes > configuration.maxSpecificationBytes) {
    failLimit('A especificação excede o limite de bytes configurado.', request, durationMs);
  }

  if (request.specification.templates.length > configuration.maxArtifacts) {
    failLimit('A especificação excede o limite de artifacts configurado.', request, durationMs);
  }

  for (const template of request.specification.templates) {
    if (
      template.format === 'TEXT' &&
      template.fragments.length > configuration.maxFragmentsPerArtifact
    ) {
      failLimit('Um template excede o limite de fragments configurado.', request, durationMs);
    }

    if (bindingCount(template) > configuration.maxBindingsPerArtifact) {
      failLimit('Um template excede o limite de bindings configurado.', request, durationMs);
    }

    if (
      bindingPaths(template).some(
        (bindingPath) => bindingPath.length > configuration.maxBindingPathDepth,
      )
    ) {
      failLimit('Um binding excede o limite de profundidade configurado.', request, durationMs);
    }
  }

  const output = request.validation.validatedOutput;
  const source = output.format === 'TEXT' ? output.content : output.data;
  if (
    typeof source !== 'string' &&
    measureJsonNestingDepth(source) > configuration.maxNestingDepth
  ) {
    failLimit('A saída validada excede o limite de aninhamento configurado.', request, durationMs);
  }
}

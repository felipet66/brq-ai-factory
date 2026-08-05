import { createLogger } from '@brq/shared/logger/logger';

import { resolveArtifactModel } from './binding-resolution';
import {
  resolveArtifactGeneratorConfiguration,
  type ArtifactGeneratorConfiguration,
} from './configuration';
import type {
  ArtifactGenerationRequest,
  ArtifactGenerationResult,
  ArtifactGenerationSource,
  ArtifactGenerator,
  CreateArtifactGeneratorOptions,
  GeneratedArtifact,
} from './contracts';
import {
  ARTIFACT_GENERATOR_ERROR_CODES,
  ArtifactGeneratorError,
  type ArtifactGenerationStage,
} from './errors';
import { deepFreeze } from './immutability';
import { logGenerationError, requestLogContext, resultLogContext } from './logging';
import { renderResolvedArtifact } from './rendering';
import { artifactGenerationResultSchema } from './schemas';
import {
  calculateGenerationHash,
  calculateSpecificationHash,
  calculateTemplateHash,
} from './structural-hashing';
import { assertGenerationPreconditions, validateArtifactGenerationRequest } from './validation';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function assertDependencies(options: CreateArtifactGeneratorOptions): void {
  const logger = options.logger;
  if (
    (options.now !== undefined && typeof options.now !== 'function') ||
    (logger !== undefined &&
      (typeof logger.debug !== 'function' ||
        typeof logger.info !== 'function' ||
        typeof logger.warn !== 'function' ||
        typeof logger.error !== 'function'))
  ) {
    throw new ArtifactGeneratorError('Configuração do Artifact Generator inválida.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST_VALIDATION',
      durationMs: 0,
    });
  }
}

function asArtifactGeneratorError(
  error: unknown,
  stage: ArtifactGenerationStage,
  durationMs: number,
  request?: ArtifactGenerationRequest,
): ArtifactGeneratorError {
  const source = request?.validation.metadata.source;

  if (error instanceof ArtifactGeneratorError) {
    const executionId = error.executionId ?? source?.executionId;
    const agentExecutionId = error.agentExecutionId ?? source?.agentExecutionId;
    const requestId = error.requestId ?? source?.requestId;
    const traceId = error.traceId ?? source?.traceId;
    if (
      error.durationMs === durationMs &&
      error.executionId === executionId &&
      error.agentExecutionId === agentExecutionId &&
      error.requestId === requestId &&
      error.traceId === traceId
    ) {
      return error;
    }

    return new ArtifactGeneratorError(error.message, {
      code: error.code,
      stage: error.stage,
      durationMs,
      ...(executionId === undefined ? {} : { executionId }),
      ...(agentExecutionId === undefined ? {} : { agentExecutionId }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(traceId === undefined ? {} : { traceId }),
      ...(error.specificationId === undefined
        ? request === undefined
          ? {}
          : { specificationId: request.specification.id }
        : { specificationId: error.specificationId }),
      ...(error.templateId === undefined ? {} : { templateId: error.templateId }),
      cause: error.cause ?? error,
    });
  }

  return new ArtifactGeneratorError('O Artifact Generator não concluiu a geração.', {
    code: ARTIFACT_GENERATOR_ERROR_CODES.INTERNAL_ERROR,
    stage,
    durationMs,
    ...(source === undefined
      ? {}
      : {
          executionId: source.executionId,
          agentExecutionId: source.agentExecutionId,
          ...(source.requestId === undefined ? {} : { requestId: source.requestId }),
          ...(source.traceId === undefined ? {} : { traceId: source.traceId }),
        }),
    ...(request === undefined ? {} : { specificationId: request.specification.id }),
    cause: error,
  });
}

function createResult(
  request: ArtifactGenerationRequest,
  artifacts: readonly GeneratedArtifact[],
  specificationHash: string,
  durationMs: number,
): ArtifactGenerationResult {
  const totalBytes = artifacts.reduce((total, artifact) => total + artifact.metadata.byteLength, 0);
  const generationHash = calculateGenerationHash({
    specificationHash,
    sourceValidationHash: request.validation.metadata.validationHash,
    sourceValidatedValueHash: request.validation.metadata.validatedValueHash!,
    artifacts,
  });
  const validationSource = request.validation.metadata.source;
  const validationContract = request.validation.metadata.contract;
  const source: ArtifactGenerationSource = {
    executionId: validationSource.executionId,
    agentExecutionId: validationSource.agentExecutionId,
    ...(validationSource.requestId === undefined ? {} : { requestId: validationSource.requestId }),
    ...(validationSource.traceId === undefined ? {} : { traceId: validationSource.traceId }),
    provider: validationSource.provider,
    model: validationSource.model,
    promptHash: validationSource.promptHash,
    outputContractHash: validationSource.outputContractHash,
    responseHash: validationSource.responseHash,
    finishReason: validationSource.finishReason,
    contractId: validationContract.id,
    contractVersion: validationContract.version,
    contractFormat: validationContract.format,
    contractHash: validationContract.contractHash,
    validationHash: request.validation.metadata.validationHash,
    validatedValueHash: request.validation.metadata.validatedValueHash!,
  };
  const parsed = artifactGenerationResultSchema.safeParse({
    artifacts,
    metadata: {
      specificationId: request.specification.id,
      specificationVersion: request.specification.version,
      specificationHash,
      source,
      artifactCount: artifacts.length,
      totalBytes,
      generationHash,
    },
  });

  if (!parsed.success) {
    throw new ArtifactGeneratorError('O resultado do Artifact Generator é inválido.', {
      code: ARTIFACT_GENERATOR_ERROR_CODES.INTERNAL_ERROR,
      stage: 'FINALIZATION',
      durationMs,
      specificationId: request.specification.id,
      cause: parsed.error,
    });
  }

  return deepFreeze(parsed.data as ArtifactGenerationResult);
}

function createConfiguredGenerator(
  configuration: ArtifactGeneratorConfiguration,
  options: CreateArtifactGeneratorOptions,
): ArtifactGenerator {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    generate(rawRequest: ArtifactGenerationRequest): ArtifactGenerationResult {
      const startedAt = now();
      let stage: ArtifactGenerationStage = 'REQUEST_VALIDATION';
      let request: ArtifactGenerationRequest | undefined;
      let logContext = {};

      try {
        request = validateArtifactGenerationRequest(rawRequest, elapsed(now, startedAt));
        logContext = requestLogContext(request);
        stage = 'SPECIFICATION_VALIDATION';
        assertGenerationPreconditions(request, configuration, elapsed(now, startedAt));
        const specificationHash = calculateSpecificationHash(request.specification);
        logContext = requestLogContext(request, specificationHash);
        logger.info('artifact.generation.started', logContext);

        const artifacts: GeneratedArtifact[] = [];
        let totalBytes = 0;
        for (const template of request.specification.templates) {
          stage = 'BINDING_RESOLUTION';
          const model = resolveArtifactModel(
            template,
            request.validation.validatedOutput!,
            calculateTemplateHash(template),
            configuration.maxArtifactBytes,
            elapsed(now, startedAt),
          );

          stage = 'RENDERING';
          const artifact = renderResolvedArtifact(
            model,
            configuration.maxArtifactBytes,
            elapsed(now, startedAt),
          );
          totalBytes += artifact.metadata.byteLength;
          stage = 'BUDGET_VALIDATION';
          if (totalBytes > configuration.maxTotalBytes) {
            throw new ArtifactGeneratorError(
              'A geração excede o limite total de bytes configurado.',
              {
                code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED,
                stage: 'BUDGET_VALIDATION',
                durationMs: elapsed(now, startedAt),
                specificationId: request.specification.id,
                templateId: template.id,
              },
            );
          }
          artifacts.push(artifact);
        }

        stage = 'FINALIZATION';
        const result = createResult(request, artifacts, specificationHash, elapsed(now, startedAt));
        logger.info(
          'artifact.generation.completed',
          resultLogContext(result, elapsed(now, startedAt)),
        );
        return result;
      } catch (error) {
        const generationError = asArtifactGeneratorError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
        );
        logGenerationError(logger, generationError, logContext);
        throw generationError;
      }
    },
  });
}

export function createArtifactGenerator(
  options: CreateArtifactGeneratorOptions = {},
): ArtifactGenerator {
  assertDependencies(options);
  const configuration = resolveArtifactGeneratorConfiguration(options.configuration);
  return createConfiguredGenerator(configuration, options);
}

import { createLogger } from '@brq/shared/logger/logger';
import type { JsonValue } from '@brq/shared/types/json-value';

import {
  resolveResponseValidatorConfiguration,
  type ResponseValidatorConfiguration,
} from './configuration';
import type {
  CreateResponseValidatorOptions,
  ResponseValidator,
  ValidationRequest,
} from './contracts';
import {
  RESPONSE_VALIDATOR_ERROR_CODES,
  ResponseValidatorError,
  type ResponseValidationStage,
} from './errors';
import { calculateCanonicalHash, calculateTextHash } from './hashing';
import { logValidationError, requestLogContext, resultLogContext } from './logging';
import { validateRequest } from './pipeline/request-stage';
import { executeValidationPipeline } from './pipeline/validation-pipeline';
import { createValidationReport } from './pipeline/validation-report';

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function assertDependencies(options: CreateResponseValidatorOptions): void {
  const logger = options.logger;
  if (
    (options.now !== undefined && typeof options.now !== 'function') ||
    (logger !== undefined &&
      (typeof logger.debug !== 'function' ||
        typeof logger.info !== 'function' ||
        typeof logger.warn !== 'function' ||
        typeof logger.error !== 'function'))
  ) {
    throw new ResponseValidatorError('Configuração do Response Validator inválida.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST',
      durationMs: 0,
    });
  }
}

function asResponseValidatorError(
  error: unknown,
  stage: ResponseValidationStage,
  durationMs: number,
  request?: ValidationRequest,
): ResponseValidatorError {
  if (error instanceof ResponseValidatorError) return error;

  return new ResponseValidatorError('O Response Validator não concluiu a validação.', {
    code: RESPONSE_VALIDATOR_ERROR_CODES.INTERNAL_ERROR,
    stage,
    durationMs,
    ...(request === undefined
      ? {}
      : {
          executionId: request.runResult.context.execution.executionId,
          agentExecutionId: request.runResult.context.execution.agentExecutionId,
        }),
    cause: error,
  });
}

function contractHash(request: ValidationRequest): string {
  return calculateCanonicalHash(request.contract as unknown as JsonValue);
}

function validateWithConfiguration(
  configuration: ResponseValidatorConfiguration,
  options: CreateResponseValidatorOptions,
): ResponseValidator {
  const logger = options.logger ?? createLogger();
  const now = options.now ?? (() => performance.now());

  return Object.freeze({
    validate(rawRequest: ValidationRequest) {
      const startedAt = now();
      let stage: ResponseValidationStage = 'REQUEST';
      let request: ValidationRequest | undefined;

      try {
        request = validateRequest(rawRequest, elapsed(now, startedAt));
        const report = createValidationReport(
          request,
          configuration.maxIssues,
          contractHash(request),
          calculateTextHash(request.runResult.output.content),
        );

        logger.info('response.validation.started', {
          ...requestLogContext(request),
          contractHash: report.contractHash,
          contentHash: report.contentHash,
        });

        const result = executeValidationPipeline(report, configuration, {
          elapsedMs: () => elapsed(now, startedAt),
          onStage: (currentStage) => {
            stage = currentStage;
          },
        });
        const durationMs = elapsed(now, startedAt);
        logger.info(
          result.valid ? 'response.validation.accepted' : 'response.validation.rejected',
          resultLogContext(result, durationMs),
        );

        return result;
      } catch (error) {
        const validationError = asResponseValidatorError(
          error,
          stage,
          elapsed(now, startedAt),
          request,
        );
        logValidationError(logger, validationError, request);
        throw validationError;
      }
    },
  });
}

export function createResponseValidator(
  options: CreateResponseValidatorOptions = {},
): ResponseValidator {
  assertDependencies(options);
  const configuration = resolveResponseValidatorConfiguration(options.configuration);
  return validateWithConfiguration(configuration, options);
}

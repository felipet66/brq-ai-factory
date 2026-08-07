import type { CreateResponseValidatorOptions, ResponseValidator } from './contracts';
import type { StructuredOutputDebugReporter } from './diagnostics';
import { RESPONSE_VALIDATOR_ERROR_CODES, ResponseValidatorError } from './errors';
import {
  createResponseValidator,
  createResponseValidatorWithDiagnostics,
} from './response-validator';

export type {
  StructuredOutputDebugReport,
  StructuredOutputDebugReporter,
  StructuredOutputDiagnosticIssue,
  StructuredOutputDiagnosticIssueCode,
  StructuredOutputFoundType,
} from './diagnostics';
export { STRUCTURED_OUTPUT_DEBUG_VERSION } from './diagnostics';

export interface StructuredOutputDebugEnvironment {
  readonly NODE_ENV?: string;
  readonly AI_FACTORY_STRUCTURED_OUTPUT_DEBUG?: string;
}

export interface CreateDevelopmentResponseValidatorOptions extends CreateResponseValidatorOptions {
  readonly environment: StructuredOutputDebugEnvironment;
  readonly reporter: StructuredOutputDebugReporter;
}

function invalidDevelopmentConfiguration(cause?: unknown): ResponseValidatorError {
  return new ResponseValidatorError('Configuração de diagnóstico do Response Validator inválida.', {
    code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONFIGURATION,
    stage: 'REQUEST',
    durationMs: 0,
    ...(cause === undefined ? {} : { cause }),
  });
}

function debugEnabled(environment: StructuredOutputDebugEnvironment): boolean {
  return (
    environment.NODE_ENV === 'development' &&
    environment.AI_FACTORY_STRUCTURED_OUTPUT_DEBUG === 'true'
  );
}

export function createDevelopmentResponseValidator(
  options: CreateDevelopmentResponseValidatorOptions,
): ResponseValidator {
  if (
    options === null ||
    typeof options !== 'object' ||
    options.environment === null ||
    typeof options.environment !== 'object' ||
    typeof options.reporter !== 'function'
  ) {
    throw invalidDevelopmentConfiguration();
  }

  const { environment, reporter, configuration, logger, now } = options;
  const validatorOptions: CreateResponseValidatorOptions = {
    ...(configuration === undefined ? {} : { configuration }),
    ...(logger === undefined ? {} : { logger }),
    ...(now === undefined ? {} : { now }),
  };

  return debugEnabled(environment)
    ? createResponseValidatorWithDiagnostics(validatorOptions, reporter)
    : createResponseValidator(validatorOptions);
}

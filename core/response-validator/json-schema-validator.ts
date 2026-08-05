import Ajv2020, {
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import type { ReadonlyJsonObject } from './canonical-json';
import type { ResponseValidatorConfiguration } from './configuration';
import { RESPONSE_VALIDATOR_ERROR_CODES, ResponseValidatorError } from './errors';
import { canonicalByteLength } from './hashing';

export interface CompiledJsonSchema {
  readonly validate: ValidateFunction;
}

export function compileJsonSchema(
  schema: ReadonlyJsonObject,
  configuration: ResponseValidatorConfiguration,
  durationMs: number,
  executionId: string,
  agentExecutionId: string,
): CompiledJsonSchema {
  if (canonicalByteLength(schema) > configuration.maxSchemaBytes || schema.$async === true) {
    throw new ResponseValidatorError('Contrato de validação JSON Schema inválido.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT,
      stage: 'CONTRACT',
      durationMs,
      executionId,
      agentExecutionId,
    });
  }

  try {
    const ajv = new Ajv2020({
      $data: false,
      allErrors: true,
      coerceTypes: false,
      ownProperties: true,
      removeAdditional: false,
      strict: true,
      useDefaults: false,
      validateFormats: true,
    });
    addFormats(ajv);

    return { validate: ajv.compile(schema as AnySchemaObject) };
  } catch (error) {
    throw new ResponseValidatorError('Contrato de validação JSON Schema inválido.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT,
      stage: 'CONTRACT',
      durationMs,
      executionId,
      agentExecutionId,
      cause: error,
    });
  }
}

export function schemaErrors(validate: ValidateFunction): readonly ErrorObject[] {
  return validate.errors ?? [];
}

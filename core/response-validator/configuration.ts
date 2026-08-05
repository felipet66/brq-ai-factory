import { z } from 'zod';

import { RESPONSE_VALIDATOR_ERROR_CODES, ResponseValidatorError } from './errors';

export const DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION = Object.freeze({
  maxContentBytes: 1024 * 1024,
  maxSchemaBytes: 128 * 1024,
  maxNestingDepth: 100,
  maxIssues: 50,
});

const ABSOLUTE_RESPONSE_VALIDATOR_LIMITS = Object.freeze({
  maxContentBytes: 16 * 1024 * 1024,
  maxSchemaBytes: 1024 * 1024,
  maxNestingDepth: 512,
  maxIssues: 500,
});

export const responseValidatorConfigurationSchema = z
  .object({
    maxContentBytes: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_RESPONSE_VALIDATOR_LIMITS.maxContentBytes)
      .default(DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION.maxContentBytes),
    maxSchemaBytes: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_RESPONSE_VALIDATOR_LIMITS.maxSchemaBytes)
      .default(DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION.maxSchemaBytes),
    maxNestingDepth: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_RESPONSE_VALIDATOR_LIMITS.maxNestingDepth)
      .default(DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION.maxNestingDepth),
    maxIssues: z
      .number()
      .int()
      .positive()
      .max(ABSOLUTE_RESPONSE_VALIDATOR_LIMITS.maxIssues)
      .default(DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION.maxIssues),
  })
  .strict();

export type ResponseValidatorConfiguration = Readonly<
  z.infer<typeof responseValidatorConfigurationSchema>
>;

export function resolveResponseValidatorConfiguration(
  input: Partial<ResponseValidatorConfiguration> | undefined,
): ResponseValidatorConfiguration {
  const result = responseValidatorConfigurationSchema.safeParse(input ?? {});

  if (!result.success) {
    throw new ResponseValidatorError('Configuração do Response Validator inválida.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONFIGURATION,
      stage: 'REQUEST',
      durationMs: 0,
      cause: result.error,
    });
  }

  return Object.freeze(result.data);
}

import type { ValidationRequest } from '../contracts';
import { RESPONSE_VALIDATOR_ERROR_CODES, ResponseValidatorError } from '../errors';
import { validationRequestSchema } from '../schemas';

export function validateRequest(input: ValidationRequest, durationMs: number): ValidationRequest {
  const result = validationRequestSchema.safeParse(input);

  if (!result.success) {
    throw new ResponseValidatorError('Solicitação do Response Validator inválida.', {
      code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_REQUEST,
      stage: 'REQUEST',
      durationMs,
      cause: result.error,
    });
  }

  return result.data as ValidationRequest;
}

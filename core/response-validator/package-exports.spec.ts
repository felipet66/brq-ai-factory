import {
  DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION,
  RESPONSE_VALIDATOR_ERROR_CODES,
  createResponseValidator,
  validationRequestSchema,
} from '@brq/response-validator';
import * as publicApi from '@brq/response-validator';
import { describe, expect, it } from 'vitest';

describe('@brq/response-validator exports', () => {
  it('exposes only the intended public entrypoint contracts', () => {
    expect(createResponseValidator).toBeTypeOf('function');
    expect(validationRequestSchema).toBeDefined();
    expect(DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION.maxIssues).toBe(50);
    expect(RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONTRACT).toBe(
      'RESPONSE_VALIDATOR_INVALID_CONTRACT',
    );
    expect(publicApi).not.toHaveProperty('createDevelopmentResponseValidator');
    expect(publicApi).not.toHaveProperty('STRUCTURED_OUTPUT_DEBUG_VERSION');
  });
});

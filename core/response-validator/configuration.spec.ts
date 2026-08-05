import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION,
  resolveResponseValidatorConfiguration,
  type ResponseValidatorConfiguration,
} from './configuration';
import { RESPONSE_VALIDATOR_ERROR_CODES } from './errors';

const INVALID_CONFIGURATIONS: Partial<ResponseValidatorConfiguration>[] = [
  { maxContentBytes: 0 },
  { maxSchemaBytes: -1 },
  { maxNestingDepth: 513 },
  { maxIssues: 501 },
];

describe('response validator configuration', () => {
  it('centralizes the approved defaults and supports instance overrides', () => {
    expect(resolveResponseValidatorConfiguration(undefined)).toEqual(
      DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION,
    );
    expect(resolveResponseValidatorConfiguration({ maxIssues: 5 })).toEqual({
      ...DEFAULT_RESPONSE_VALIDATOR_CONFIGURATION,
      maxIssues: 5,
    });
  });

  it.each(INVALID_CONFIGURATIONS)('rejects invalid configuration %j', (configuration) => {
    expect(() => resolveResponseValidatorConfiguration(configuration)).toThrowError(
      expect.objectContaining({ code: RESPONSE_VALIDATOR_ERROR_CODES.INVALID_CONFIGURATION }),
    );
  });
});

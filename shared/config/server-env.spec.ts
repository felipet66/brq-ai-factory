import { describe, expect, it } from 'vitest';

import { AppError } from '../errors/app-error';
import { parseServerEnv } from './server-env';

describe('parseServerEnv', () => {
  it('should accept a local SQLite DATABASE_URL', () => {
    expect(parseServerEnv({ DATABASE_URL: 'file:./dev.db' })).toEqual({
      DATABASE_URL: 'file:./dev.db',
    });
  });

  it('should reject a missing DATABASE_URL without exposing validation details', () => {
    expect(() => parseServerEnv({})).toThrowError(AppError);
  });
});

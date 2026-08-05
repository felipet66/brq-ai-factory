import { describe, expect, it } from 'vitest';

import { AppError, toSafeErrorResponse } from './app-error';
import { ERROR_CODES } from './error-codes';

describe('toSafeErrorResponse', () => {
  it('should hide internal error details by default', () => {
    const result = toSafeErrorResponse(new Error('SQLite failed at /private/path'));

    expect(result).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Não foi possível concluir a operação.',
    });
  });

  it('should expose an explicitly safe operational error', () => {
    const result = toSafeErrorResponse(
      new AppError('Entrada inválida.', {
        code: ERROR_CODES.INVALID_INPUT,
        statusCode: 400,
        expose: true,
      }),
    );

    expect(result).toEqual({ code: 'INVALID_INPUT', message: 'Entrada inválida.' });
  });
});

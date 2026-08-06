// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { HttpApiError, mapTechnicalError } from './errors';

describe('technical HTTP error mapping', () => {
  it('preserves safe adapter errors and sanitizes unknown errors', () => {
    const safe = new HttpApiError('Mensagem segura.', {
      code: 'INVALID_REQUEST',
      status: 400,
    });

    expect(mapTechnicalError(safe)).toBe(safe);
    expect(mapTechnicalError(new Error('segredo'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'Ocorreu um erro interno.',
    });
  });
});

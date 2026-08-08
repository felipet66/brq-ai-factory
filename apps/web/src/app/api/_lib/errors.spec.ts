// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { AuthenticationError } from '@/server/auth/errors';

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

  it.each([
    ['AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED', 401],
    ['AUTHORIZATION_DENIED', 'AUTHORIZATION_DENIED', 403],
    ['CSRF_REJECTED', 'CSRF_REJECTED', 403],
    ['AUTHENTICATION_UNAVAILABLE', 'AUTHENTICATION_UNAVAILABLE', 503],
  ] as const)('maps the %s authentication boundary error', (kind, code, status) => {
    expect(mapTechnicalError(new AuthenticationError('Mensagem segura.', kind))).toMatchObject({
      code,
      status,
      message: 'Mensagem segura.',
    });
  });
});

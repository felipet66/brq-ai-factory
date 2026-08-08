import { parseAuthenticationEnvironment } from './config';
import { AuthenticationError } from './errors';

export function assertSameOriginMutation(request: Request, configuredOrigin?: string): void {
  let expectedOrigin: string;
  try {
    expectedOrigin = configuredOrigin ?? parseAuthenticationEnvironment(process.env).appOrigin;
  } catch (error) {
    throw new AuthenticationError(
      'O serviço de autenticação não está disponível.',
      'AUTHENTICATION_UNAVAILABLE',
      error,
    );
  }
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site' || origin === null) {
    throw new AuthenticationError('A origem da requisição não é confiável.', 'CSRF_REJECTED');
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch (error) {
    throw new AuthenticationError(
      'A origem da requisição não é confiável.',
      'CSRF_REJECTED',
      error,
    );
  }
  if (normalizedOrigin !== expectedOrigin) {
    throw new AuthenticationError('A origem da requisição não é confiável.', 'CSRF_REJECTED');
  }
}

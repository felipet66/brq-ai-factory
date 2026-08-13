import { parseAuthenticationEnvironment } from './config';
import { AuthenticationError } from './errors';

function resolveExpectedOrigin(configuredOrigin?: string): string {
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
  return expectedOrigin;
}

function rejectUntrustedOrigin(cause?: unknown): never {
  throw new AuthenticationError('A origem da requisição não é confiável.', 'CSRF_REJECTED', cause);
}

export function assertSameOriginMutation(request: Request, configuredOrigin?: string): void {
  const expectedOrigin = resolveExpectedOrigin(configuredOrigin);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site' || origin === null) {
    rejectUntrustedOrigin();
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch (error) {
    rejectUntrustedOrigin(error);
  }
  if (normalizedOrigin !== expectedOrigin) {
    rejectUntrustedOrigin();
  }
}

export function assertSameOriginNavigationMutation(
  request: Request,
  configuredOrigin?: string,
): void {
  const origin = request.headers.get('origin');
  if (origin !== null) {
    assertSameOriginMutation(request, configuredOrigin);
    return;
  }

  const expectedOrigin = resolveExpectedOrigin(configuredOrigin);
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();
  const fetchMode = request.headers.get('sec-fetch-mode')?.toLowerCase();
  const fetchDestination = request.headers.get('sec-fetch-dest')?.toLowerCase();
  if (fetchSite !== 'same-origin' || fetchMode !== 'navigate' || fetchDestination !== 'document') {
    rejectUntrustedOrigin();
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch (error) {
    rejectUntrustedOrigin(error);
  }
  if (requestOrigin !== expectedOrigin) {
    rejectUntrustedOrigin();
  }
}

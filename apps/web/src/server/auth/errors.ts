export type AuthenticationErrorKind =
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'AUTHENTICATION_UNAVAILABLE'
  | 'CSRF_REJECTED';

export class AuthenticationError extends Error {
  readonly kind: AuthenticationErrorKind;

  constructor(message: string, kind: AuthenticationErrorKind, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AuthenticationError';
    this.kind = kind;
  }
}

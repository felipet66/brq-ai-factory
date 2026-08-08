import type { AuthenticatedUser, AuthenticatedUserRole } from '@/api/auth-contracts';

export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly role: AuthenticatedUserRole;
  readonly user: AuthenticatedUser;
}

export type RequestAuthenticator = (
  request: Request,
  requestId: string,
) => Promise<AuthenticatedPrincipal>;

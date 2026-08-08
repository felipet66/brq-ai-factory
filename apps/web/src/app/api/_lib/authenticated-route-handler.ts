import type { Logger } from '@brq/shared/logger/logger';

import type { AuthenticatedPrincipal, RequestAuthenticator } from '@/server/auth/contracts';

import {
  createRouteHandler,
  type RouteHandlerBaseOptions,
  type RouteOperationResult,
} from './route-handler';

interface AuthenticatedRouteHandlerOptions<Context> extends RouteHandlerBaseOptions {
  readonly authenticate: RequestAuthenticator;
  readonly logger?: Logger;
  readonly operation: (
    request: Request,
    context: Context,
    requestId: string,
    principal: AuthenticatedPrincipal,
  ) => Promise<RouteOperationResult> | RouteOperationResult;
}

export function createAuthenticatedRouteHandler<Context>(
  options: AuthenticatedRouteHandlerOptions<Context>,
): (request: Request, context: Context) => Promise<Response> {
  return createRouteHandler<Context>({
    ...options,
    async operation(request, context, requestId) {
      const principal = await options.authenticate(request, requestId);
      return options.operation(request, context, requestId, principal);
    },
  });
}

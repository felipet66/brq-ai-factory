import type { Logger } from '@brq/shared/logger/logger';

import { API_ENDPOINTS } from './constants';
import type { RequestIdFactory } from './contracts';
import { rejectQueryParameters } from './request';
import { healthResponse } from './responses';
import { createRouteHandler } from './route-handler';

interface HealthHandlerOptions {
  readonly logger?: Logger;
  readonly now?: () => number;
  readonly requestIdFactory?: RequestIdFactory;
}

export function createHealthHandler(options: HealthHandlerOptions = {}) {
  return createRouteHandler<unknown>({
    endpoint: API_ENDPOINTS.HEALTH,
    allowedMethods: ['GET'],
    ...options,
    operation(request, _context, requestId) {
      rejectQueryParameters(request);
      return { response: healthResponse(requestId) };
    },
  });
}

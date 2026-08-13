import { authenticateRequest } from '@/server/auth/session';
import {
  getExecutionRepositoryForRead,
  getExecutionRerunDispatcherForPrincipal,
} from '@/server/runtime';

import { createExecutionRerunHandler } from '../../../_lib/execution-rerun-handler';

export const runtime = 'nodejs';

const handler = createExecutionRerunHandler({
  authenticate: authenticateRequest,
  getExecutionRepository: getExecutionRepositoryForRead,
  getExecutionRerunDispatcher: getExecutionRerunDispatcherForPrincipal,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

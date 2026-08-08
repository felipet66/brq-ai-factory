import { authenticateRequest } from '@/server/auth/session';
import { getExecutionRepositoryForRead } from '@/server/runtime';

import { createExecutionLookupHandler } from '../../_lib/execution-lookup-handler';

export const runtime = 'nodejs';

const handler = createExecutionLookupHandler({
  authenticate: authenticateRequest,
  getExecutionRepository: getExecutionRepositoryForRead,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

import { authenticateRequest } from '@/server/auth/session';
import { getPreviewApplicationService } from '@/server/runtime';

import { createExecutionPreviewHandler } from '../../../_lib/preview-handler';

export const runtime = 'nodejs';

const handler = createExecutionPreviewHandler({
  authenticate: authenticateRequest,
  getService: getPreviewApplicationService,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

import { createPlaygroundAgentsHandler } from '@/app/api/_lib/playground-handler';
import { authenticateRequest } from '@/server/auth/session';
import { getPlaygroundRuntime } from '@/server/playground/prompt-inspection-runtime';

export const runtime = 'nodejs';

const handler = createPlaygroundAgentsHandler({
  authenticate: authenticateRequest,
  getPromptInspector: getPlaygroundRuntime,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

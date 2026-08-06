import { getExecutionEngine } from '@/server/runtime';

import { createExecutionsHandler } from '../_lib/executions-handler';

export const runtime = 'nodejs';

const handler = createExecutionsHandler({ getExecutionEngine });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

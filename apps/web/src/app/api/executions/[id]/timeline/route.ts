import { getExecutionHistory } from '@/server/runtime';

import { createExecutionTimelineHandler } from '../../../_lib/execution-timeline-handler';

export const runtime = 'nodejs';

const handler = createExecutionTimelineHandler({ getExecutionHistory });

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

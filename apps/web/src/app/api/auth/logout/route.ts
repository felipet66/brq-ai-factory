import { createLogoutHandler } from '../../_lib/auth-handler';

export const runtime = 'nodejs';

const handler = createLogoutHandler();

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

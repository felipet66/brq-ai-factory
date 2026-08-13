import { authenticateRequest } from '@/server/auth/session';
import {
  getTechnicalCheckpointRepositoryForPrincipal,
  getTechnicalResumeDispatcherForPrincipal,
} from '@/server/runtime';

import { createExecutionTechnicalResumeHandler } from '../../../_lib/execution-technical-resume-handler';

export const runtime = 'nodejs';

const handler = createExecutionTechnicalResumeHandler({
  authenticate: authenticateRequest,
  getDispatcher: getTechnicalResumeDispatcherForPrincipal,
  getRepository: getTechnicalCheckpointRepositoryForPrincipal,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

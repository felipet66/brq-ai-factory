import { createPreviewGatewayHandler } from '@/server/preview/gateway-handler';
import { getPreviewGatewayService, getPreviewOriginTemplate } from '@/server/runtime';

export const runtime = 'nodejs';

const handler = createPreviewGatewayHandler({
  getOriginTemplate: getPreviewOriginTemplate,
  getService: getPreviewGatewayService,
});

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;

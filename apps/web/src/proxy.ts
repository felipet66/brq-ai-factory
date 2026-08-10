import { NextResponse, type NextRequest } from 'next/server';

import { previewIdFromRequestUrl } from '@/server/preview/configuration';

export function proxy(request: NextRequest) {
  const template = process.env.BRQ_PREVIEW_ORIGIN_TEMPLATE;
  if (template === undefined) return NextResponse.next();
  let previewId: string | null;
  try {
    previewId = previewIdFromRequestUrl(template, request.url);
  } catch {
    return NextResponse.next();
  }
  if (previewId === null) return NextResponse.next();
  const target = request.nextUrl.clone();
  const path = target.pathname === '/' ? '' : target.pathname;
  target.pathname = `/api/_preview-gateway/${previewId}${path}`;
  return NextResponse.rewrite(target);
}

export const config = { matcher: '/:path*' };

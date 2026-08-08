import {
  promptInspectionCatalogSchema,
  promptInspectionPreviewResultSchema,
  promptInspectionValidationResultSchema,
  type PromptInspectionCatalog,
  type PromptInspectionPreviewResult,
  type PromptInspectionValidationResult,
} from '@brq/prompt-inspector';
import { z } from 'zod';

import { HTTP_API_VERSION } from './constants';
import { responseHeaders } from './response-foundation';
import { apiResponseMetadataSchema } from './schemas';

type PlaygroundResponseData =
  PromptInspectionCatalog | PromptInspectionPreviewResult | PromptInspectionValidationResult;

const playgroundSuccessResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.union([
      promptInspectionCatalogSchema,
      promptInspectionPreviewResultSchema,
      promptInspectionValidationResultSchema,
    ]),
    metadata: apiResponseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export function playgroundSuccessResponse(
  data: PlaygroundResponseData,
  requestId: string,
): Response {
  const body = playgroundSuccessResponseSchema.parse({
    success: true,
    data,
    metadata: { requestId, apiVersion: HTTP_API_VERSION },
    errors: [],
  });
  return new Response(JSON.stringify(body), { status: 200, headers: responseHeaders(requestId) });
}

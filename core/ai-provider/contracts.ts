import type { z } from 'zod';

import type {
  aiRequestSchema,
  aiResponseFinishReasonSchema,
  aiResponseFormatSchema,
  aiResponseSchema,
} from './schemas';

export type AIResponseFormat = z.infer<typeof aiResponseFormatSchema>;
export type AIRequest = z.infer<typeof aiRequestSchema>;
export type AIResponseFinishReason = z.infer<typeof aiResponseFinishReasonSchema>;
export type AIResponse = z.infer<typeof aiResponseSchema>;
export type AICacheMode = 'READ_WRITE' | 'REQUIRE_HIT';
export type AICacheAgent = 'PRODUCT_OWNER' | 'DEVELOPER' | 'QA' | 'CODE_GENERATOR';

export interface AIGenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  traceId?: string;
  cacheMode?: AICacheMode;
  /** Current execution checkpoint receiving or consuming the response. */
  executionId?: string;
  agent?: AICacheAgent;
  /** Source checkpoint used only by strict replay. */
  sourceExecutionId?: string;
}

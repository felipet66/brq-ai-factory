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

export interface AIGenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
  traceId?: string;
}

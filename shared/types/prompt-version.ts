import type { z } from 'zod';

import type {
  promptVersionCreateInputSchema,
  promptVersionSchema,
  promptVersionStatusSchema,
} from '../schemas/prompt-version.schema';

export type PromptVersionStatus = z.infer<typeof promptVersionStatusSchema>;
export type PromptVersionCreateInput = z.infer<typeof promptVersionCreateInputSchema>;
export type PromptVersion = z.infer<typeof promptVersionSchema>;

import { z } from 'zod';

/**
 * Immutable, host-owned delivery intent. It is part of the execution request and therefore of
 * the execution identity; it is not an execution-profile capability or an agent-authored value.
 */
export const deliveryModeSchema = z.enum(['GREENFIELD', 'CHANGE']);

export const deliveryIntentSchema = z
  .object({
    version: z.literal('1.0.0'),
    mode: deliveryModeSchema,
  })
  .strict();

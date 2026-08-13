import type { z } from 'zod';

import type { deliveryIntentSchema, deliveryModeSchema } from '../schemas/delivery-intent.schema';

export type DeliveryMode = z.infer<typeof deliveryModeSchema>;
export type DeliveryIntent = z.infer<typeof deliveryIntentSchema>;

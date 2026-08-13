import { deliveryIntentSchema } from '../schemas/delivery-intent.schema';
import type { DeliveryIntent } from '../types/delivery-intent';

export const GREENFIELD_DELIVERY_INTENT: DeliveryIntent = Object.freeze(
  deliveryIntentSchema.parse({ version: '1.0.0', mode: 'GREENFIELD' }),
);

export const CHANGE_DELIVERY_INTENT: DeliveryIntent = Object.freeze(
  deliveryIntentSchema.parse({ version: '1.0.0', mode: 'CHANGE' }),
);

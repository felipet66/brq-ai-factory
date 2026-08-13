import { describe, expect, it } from 'vitest';

import { CHANGE_DELIVERY_INTENT, GREENFIELD_DELIVERY_INTENT } from '../constants/delivery-intent';
import { deliveryIntentSchema } from './delivery-intent.schema';

describe('Delivery intent contract', () => {
  it.each([GREENFIELD_DELIVERY_INTENT, CHANGE_DELIVERY_INTENT])(
    'accepts the immutable host-owned intent $mode',
    (intent) => {
      expect(deliveryIntentSchema.parse(intent)).toEqual(intent);
      expect(Object.isFrozen(intent)).toBe(true);
    },
  );

  it.each([
    {},
    { mode: 'GREENFIELD' },
    { version: '1.0.1', mode: 'GREENFIELD' },
    { version: '1.0.0', mode: 'UNDECLARED' },
    { version: '1.0.0', mode: 'GREENFIELD', allowedChangeTypes: ['MODIFY'] },
  ])('rejects malformed, unversioned or capability-bearing values %#', (candidate) => {
    expect(deliveryIntentSchema.safeParse(candidate).success).toBe(false);
  });
});

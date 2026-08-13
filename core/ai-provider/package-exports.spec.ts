import { describe, expect, it } from 'vitest';

import * as publicApi from './index';

describe('AI provider public exports', () => {
  it('exports the exact persistent cache boundary', () => {
    expect(publicApi.createCachedAIProvider).toBeTypeOf('function');
    expect(publicApi.calculateAIRequestHash).toBeTypeOf('function');
    expect(publicApi.calculateAIResponseHash).toBeTypeOf('function');
  });
});

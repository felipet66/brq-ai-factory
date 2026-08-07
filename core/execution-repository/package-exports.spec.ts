import { describe, expect, it } from 'vitest';

import * as publicApi from './index';

describe('execution repository public exports', () => {
  it('exports the port adapters, coordinator, recorder and schemas', () => {
    expect(publicApi.createInMemoryExecutionRecordRepository).toBeTypeOf('function');
    expect(publicApi.createPersistentExecutionEngine).toBeTypeOf('function');
    expect(publicApi.createRepositoryBackedExecutionHistory).toBeTypeOf('function');
    expect(publicApi.executionRecordSchema).toBeDefined();
    expect(publicApi.ExecutionRepositoryError).toBeTypeOf('function');
  });
});

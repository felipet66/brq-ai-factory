import {
  OBSERVABILITY_VERSION,
  createInMemoryExecutionHistory,
  createObservabilityLogger,
  createObservedExecutionEngine,
  executionObservabilitySnapshotSchema,
} from '@brq/observability';
import { describe, expect, it } from 'vitest';

describe('@brq/observability package exports', () => {
  it('expõe apenas contratos, schemas e factories públicas', async () => {
    expect(OBSERVABILITY_VERSION).toBe('1.0.0');
    expect(createInMemoryExecutionHistory).toBeTypeOf('function');
    expect(createObservabilityLogger).toBeTypeOf('function');
    expect(createObservedExecutionEngine).toBeTypeOf('function');
    expect(executionObservabilitySnapshotSchema).toBeDefined();
    const publicApi = await import('@brq/observability');
    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).not.toHaveProperty('stageMetricsFromResult');
  });
});

import {
  FACTORY_OBSERVABILITY_VERSION,
  OBSERVABILITY_VERSION,
  createInMemoryExecutionHistory,
  createInMemoryFactoryExecutionHistory,
  createObservabilityLogger,
  createObservedExecutionEngine,
  createObservedFactoryPipeline,
  executionObservabilitySnapshotSchema,
} from '@brq/observability';
import { describe, expect, it } from 'vitest';

describe('@brq/observability package exports', () => {
  it('expõe apenas contratos, schemas e factories públicas', async () => {
    expect(OBSERVABILITY_VERSION).toBe('1.0.0');
    expect(FACTORY_OBSERVABILITY_VERSION).toBe('3.0.0');
    expect(createInMemoryExecutionHistory).toBeTypeOf('function');
    expect(createInMemoryFactoryExecutionHistory).toBeTypeOf('function');
    expect(createObservabilityLogger).toBeTypeOf('function');
    expect(createObservedExecutionEngine).toBeTypeOf('function');
    expect(createObservedFactoryPipeline).toBeTypeOf('function');
    expect(executionObservabilitySnapshotSchema).toBeDefined();
    const publicApi = await import('@brq/observability');
    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).not.toHaveProperty('stageMetricsFromResult');
  });
});

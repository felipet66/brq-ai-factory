import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_ENGINE_ERROR_CODES,
  EXECUTION_ENGINE_VERSION,
  createExecutionEngine,
  executionRequestSchema,
  executionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
} from '@brq/execution-engine';
import { describe, expect, it } from 'vitest';

import { createExecutionRequestFixture } from './testing/execution-engine-fixtures';

describe('@brq/execution-engine package exports', () => {
  it('expõe somente fachada, versões, contratos, schemas e erros públicos', () => {
    const request: ExecutionRequest = createExecutionRequestFixture();
    const resultTypeCheck: ExecutionResult | undefined = undefined;
    expect(createExecutionEngine).toBeTypeOf('function');
    expect(executionRequestSchema.safeParse(request).success).toBe(true);
    expect(executionResultSchema).toBeDefined();
    expect(EXECUTION_ENGINE_VERSION).toBe('1.0.0');
    expect(EXECUTION_CONTRACT_VERSION).toBe('1.0.0');
    expect(EXECUTION_ENGINE_ERROR_CODES.CANCELLED).toBe('EXECUTION_ENGINE_CANCELLED');
    expect(resultTypeCheck).toBeUndefined();
  });

  it('não expõe helpers internos de hashing, estado, resultado ou logging', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/execution-engine');
    expect(publicApi).not.toHaveProperty('calculateCanonicalJsonHash');
    expect(publicApi).not.toHaveProperty('createDeterministicExecutionId');
    expect(publicApi).not.toHaveProperty('transitionExecutionState');
    expect(publicApi).not.toHaveProperty('createExecutionResult');
    expect(publicApi).not.toHaveProperty('executionLogContext');
  });
});

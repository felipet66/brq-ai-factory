import { ExecutionEngineError, type ExecutionEngine } from '@brq/execution-engine';
import { describe, expect, it, vi } from 'vitest';

import type { ExecutionHistoryRecorder } from './contracts';
import { createObservedExecutionEngine } from './observed-execution-engine';
import {
  createObservabilityRequest,
  createSuccessfulExecutionResult,
} from './testing/observability-fixtures';

function recorder(): ExecutionHistoryRecorder {
  const begin = vi.fn<ExecutionHistoryRecorder['begin']>();
  const complete = vi.fn<ExecutionHistoryRecorder['complete']>();
  return { begin, capture() {}, complete, get: () => null };
}

describe('Observed Execution Engine', () => {
  it('preserva exatamente o resultado e os hashes do Engine decorado', async () => {
    const request = createObservabilityRequest();
    const result = await createSuccessfulExecutionResult(request);
    const engine: ExecutionEngine = { execute: vi.fn(async () => result) };
    const history = recorder();
    const observed = await createObservedExecutionEngine({ engine, history }).execute(request);
    expect(observed).toBe(result);
    expect(observed.hashes).toEqual(result.hashes);
    expect(history.begin).toHaveBeenCalledWith(request);
    expect(history.complete).toHaveBeenCalledWith(result);
  });

  it('não transforma erro técnico do Engine', async () => {
    const request = createObservabilityRequest();
    const failure = new Error('engine failure');
    const engine: ExecutionEngine = { execute: async () => Promise.reject(failure) };
    const history = recorder();
    const caught = await createObservedExecutionEngine({ engine, history })
      .execute(request)
      .catch((error: unknown) => error);
    expect(caught).toBe(failure);
    expect(history.complete).not.toHaveBeenCalled();
  });

  it('mantém a execução fail-open quando o histórico falha', async () => {
    const request = createObservabilityRequest();
    const result = await createSuccessfulExecutionResult(request);
    const engine: ExecutionEngine = { execute: vi.fn(async () => result) };
    const history = recorder();
    vi.mocked(history.begin).mockImplementation(() => {
      throw new Error('history begin failure');
    });
    vi.mocked(history.complete).mockImplementation(() => {
      throw new Error('history complete failure');
    });

    await expect(createObservedExecutionEngine({ engine, history }).execute(request)).resolves.toBe(
      result,
    );
    expect(engine.execute).toHaveBeenCalledOnce();
    expect(history.begin).toHaveBeenCalledOnce();
    expect(history.complete).toHaveBeenCalledWith(result);
  });

  it('preserva erro terminal, resultado parcial e AbortSignal por identidade', async () => {
    const request = createObservabilityRequest();
    const result = await createSuccessfulExecutionResult(request);
    const controller = new AbortController();
    const failure = new ExecutionEngineError('cancelled', {
      code: 'EXECUTION_ENGINE_CANCELLED',
      state: 'CANCELLED',
      durationMs: result.metrics.observed.totalDurationMs,
      executionId: result.executionId,
      workflowId: result.workflowId,
      result,
    });
    const engine: ExecutionEngine = {
      execute: vi.fn(async (_request, options) => {
        expect(options?.signal).toBe(controller.signal);
        throw failure;
      }),
    };
    const history = recorder();
    vi.mocked(history.complete).mockImplementation(() => {
      throw new Error('history failure');
    });

    const caught = await createObservedExecutionEngine({ engine, history })
      .execute(request, { signal: controller.signal })
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(engine.execute).toHaveBeenCalledOnce();
    expect(history.complete).toHaveBeenCalledWith(result);
  });

  it('rejeita engine sem fachada pública', () => {
    expect(() =>
      createObservedExecutionEngine({
        engine: {} as ExecutionEngine,
        history: recorder(),
      }),
    ).toThrow(TypeError);
  });
});

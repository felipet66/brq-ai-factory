import {
  FACTORY_PIPELINE_ERROR_CODES,
  FactoryPipelineError,
  type FactoryExecutionResult,
  type FactoryPipelineCoordinator,
} from '@brq/factory-pipeline';
import { describe, expect, it, vi } from 'vitest';

import type { FactoryExecutionHistoryRecorder } from './contracts';
import { createObservedFactoryPipeline } from './observed-factory-pipeline';
import { createObservabilityRequest } from './testing/observability-fixtures';

function result(): FactoryExecutionResult {
  return {
    executionId: `execution-${'a'.repeat(32)}`,
    workflowId: 'workflow-test',
    status: 'SUCCESS',
  } as FactoryExecutionResult;
}

function recorder(): FactoryExecutionHistoryRecorder {
  return {
    beginFactory: vi.fn(),
    capture: vi.fn(),
    completeFactory: vi.fn(),
    get: vi.fn(() => null),
  };
}

describe('Observed Factory Pipeline', () => {
  it('preserva resultado, identidade e AbortSignal', async () => {
    const request = createObservabilityRequest();
    const terminal = { ...result(), workflowId: request.workflowId } as FactoryExecutionResult;
    const controller = new AbortController();
    const pipeline: FactoryPipelineCoordinator = {
      execute: vi.fn(async (_request, options) => {
        expect(options?.signal).toBe(controller.signal);
        return terminal;
      }),
    };
    const history = recorder();

    await expect(
      createObservedFactoryPipeline({ pipeline, history }).execute(request, {
        signal: controller.signal,
      }),
    ).resolves.toBe(terminal);
    expect(history.beginFactory).toHaveBeenCalledWith(request);
    expect(history.completeFactory).toHaveBeenCalledWith(terminal);
  });

  it('registra resultado terminal anexado sem transformar o erro', async () => {
    const request = createObservabilityRequest();
    const terminal = { ...result(), workflowId: request.workflowId } as FactoryExecutionResult;
    const failure = new FactoryPipelineError('terminal', {
      code: FACTORY_PIPELINE_ERROR_CODES.SANDBOX_FAILED,
      stage: 'SANDBOX_TEST',
      result: terminal,
    });
    const pipeline: FactoryPipelineCoordinator = {
      execute: async () => Promise.reject(failure),
    };
    const history = recorder();

    await expect(
      createObservedFactoryPipeline({ pipeline, history }).execute(request),
    ).rejects.toBe(failure);
    expect(history.completeFactory).toHaveBeenCalledWith(terminal);
  });

  it('mantém observabilidade fail-open e valida as capabilities', async () => {
    const request = createObservabilityRequest();
    const terminal = { ...result(), workflowId: request.workflowId } as FactoryExecutionResult;
    const pipeline: FactoryPipelineCoordinator = { execute: async () => terminal };
    const history = recorder();
    vi.mocked(history.beginFactory).mockImplementation(() => {
      throw new Error('begin');
    });
    vi.mocked(history.completeFactory).mockImplementation(() => {
      throw new Error('complete');
    });

    await expect(
      createObservedFactoryPipeline({ pipeline, history }).execute(request),
    ).resolves.toBe(terminal);
    expect(() =>
      createObservedFactoryPipeline({
        pipeline: {} as FactoryPipelineCoordinator,
        history,
      }),
    ).toThrow(TypeError);
  });
});

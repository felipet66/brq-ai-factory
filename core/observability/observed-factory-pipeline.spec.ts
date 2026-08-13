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
  it('encaminha o preflight sem iniciar observabilidade de execução', async () => {
    const preflight = vi.fn(async () => undefined);
    const history = recorder();
    const observed = createObservedFactoryPipeline({
      pipeline: { preflight, execute: async () => result() },
      history,
    });

    await expect(observed.preflight?.()).resolves.toBeUndefined();

    expect(preflight).toHaveBeenCalledOnce();
    expect(history.beginFactory).not.toHaveBeenCalled();
  });

  it('encaminha o resume técnico exatamente e preserva o bind da capability original', async () => {
    const history = recorder();
    const checkpoint = { checkpointHash: 'a'.repeat(64) } as never;
    const resumeOptions = {
      attemptId: 'technical-resume-4fbd475c-ced4-47ed-aad5-82a772ea75cd',
    } as const;
    const resumed = { status: 'SUCCESS', resultHash: 'b'.repeat(64) } as never;
    const pipeline: FactoryPipelineCoordinator = {
      execute: async () => result(),
      async resumeTechnical(observedCheckpoint, observedOptions) {
        expect(this).toBe(pipeline);
        expect(observedCheckpoint).toBe(checkpoint);
        expect(observedOptions).toBe(resumeOptions);
        return resumed;
      },
    };
    const observed = createObservedFactoryPipeline({ pipeline, history });

    await expect(observed.resumeTechnical?.(checkpoint, resumeOptions)).resolves.toBe(resumed);

    expect(history.beginFactory).not.toHaveBeenCalled();
    expect(history.completeFactory).not.toHaveBeenCalled();
  });

  it('não anuncia resume técnico quando o pipeline original não suporta a capability', () => {
    const observed = createObservedFactoryPipeline({
      pipeline: { execute: async () => result() },
      history: recorder(),
    });

    expect(observed).not.toHaveProperty('resumeTechnical');
  });

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

import {
  ORCHESTRATOR_ERROR_CODES,
  OrchestratorError,
  type Orchestrator,
  type WorkflowRequest,
  type WorkflowResult,
} from '@brq/orchestrator';
import { createLogger } from '@brq/shared/logger/logger';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExecutionRequest } from './contracts';
import {
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_ENGINE_VERSION,
  createExecutionEngine,
} from './execution-engine';
import { EXECUTION_ENGINE_ERROR_CODES, ExecutionEngineError } from './errors';
import { calculateCanonicalJsonHash, createDeterministicExecutionId } from './hashing';
import {
  createExecutionRequestFixture,
  createSuccessfulWorkflowResultFixture,
  createTerminalWorkflowResultFixture,
  createWorkflowRequestForExecution,
  incrementalClock,
} from './testing/execution-engine-fixtures';

describe('Execution Engine', () => {
  let request: ExecutionRequest;
  let workflowRequest: WorkflowRequest;
  let successfulWorkflow: WorkflowResult;

  beforeAll(async () => {
    request = createExecutionRequestFixture();
    const requestHash = calculateCanonicalJsonHash(request);
    const executionId = createDeterministicExecutionId(requestHash, EXECUTION_CONTRACT_VERSION);
    workflowRequest = createWorkflowRequestForExecution(request, executionId);
    successfulWorkflow = await createSuccessfulWorkflowResultFixture(workflowRequest);
  });

  it('cria o executionId, chama o Orchestrator uma vez e consolida sucesso', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => successfulWorkflow);
    const result = await createExecutionEngine({
      orchestrator: { execute },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(1_000, 10),
    }).execute(request, { signal: controller.signal });

    expect(result.executionId).toBe(workflowRequest.executionId);
    expect(result.executionId).toMatch(/^execution-[a-f0-9]{32}$/);
    expect(result.status).toBe('SUCCESS');
    expect(result.metadata).toEqual({
      engineVersion: EXECUTION_ENGINE_VERSION,
      contractVersion: EXECUTION_CONTRACT_VERSION,
      attempt: 1,
    });
    expect(result.startedAt).toBe('1970-01-01T00:00:01.020Z');
    expect(result.finishedAt).toBe('1970-01-01T00:00:01.030Z');
    expect(result.lineage).toEqual(successfulWorkflow.lineage);
    expect(result.provenance).toEqual(successfulWorkflow.provenance);
    expect(result.metrics.observed.orchestratorInvocations).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.timeline)).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(workflowRequest, { signal: controller.signal });
  });

  it('mantém ID e hashes estáveis apesar de timestamps observacionais diferentes', async () => {
    const first = await createExecutionEngine({
      orchestrator: { execute: async () => successfulWorkflow },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(0, 5),
    }).execute(request);
    const second = await createExecutionEngine({
      orchestrator: { execute: async () => successfulWorkflow },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(10_000, 17),
    }).execute(structuredClone(request));

    expect(first.executionId).toBe(second.executionId);
    expect(first.hashes).toEqual(second.hashes);
    expect(first.startedAt).not.toBe(second.startedAt);
    expect(first.finishedAt).not.toBe(second.finishedAt);
    expect(first.metrics.observed.totalDurationMs).not.toBe(
      second.metrics.observed.totalDurationMs,
    );
  });

  it('retorna FAILED para rejeição funcional do workflow', async () => {
    const failedWorkflow = createTerminalWorkflowResultFixture(successfulWorkflow, 'FAILED');
    const result = await createExecutionEngine({
      orchestrator: { execute: async () => failedWorkflow },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    }).execute(request);

    expect(result.status).toBe('FAILED');
    expect(result.failure).toMatchObject({
      kind: 'WORKFLOW_FAILED',
      sourceCode: 'ORCHESTRATOR_QA_FAILED',
    });
    expect(result.workflowResult).toEqual(failedWorkflow);
  });

  it('propaga falha técnica com WorkflowResult parcial validado', async () => {
    const partial = createTerminalWorkflowResultFixture(successfulWorkflow, 'FAILED');
    const orchestrator: Orchestrator = {
      execute: async () => {
        throw new OrchestratorError('detalhe interno', {
          code: ORCHESTRATOR_ERROR_CODES.QA_FAILED,
          stage: 'QA',
          durationMs: 10,
          executionId: partial.executionId,
          workflowId: partial.workflowId,
          result: partial,
        });
      },
    };
    const error = await createExecutionEngine({
      orchestrator,
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionEngineError);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.ORCHESTRATOR_FAILED,
      sourceCode: ORCHESTRATOR_ERROR_CODES.QA_FAILED,
      result: { status: 'FAILED', workflowResult: partial },
    });
  });

  it('encerra como FAILED com workflow nulo em erro técnico genérico', async () => {
    const error = await createExecutionEngine({
      orchestrator: {
        execute: async () => {
          throw new Error('segredo interno');
        },
      },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionEngineError);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.ORCHESTRATOR_FAILED,
      result: {
        status: 'FAILED',
        workflowResult: null,
        lineage: null,
        provenance: null,
      },
    });
  });

  it('cancela antes de RUNNING sem invocar o Orchestrator', async () => {
    const execute = vi.fn(async () => successfulWorkflow);
    const controller = new AbortController();
    controller.abort();
    const error = await createExecutionEngine({
      orchestrator: { execute },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request, { signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionEngineError);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
      result: {
        status: 'CANCELLED',
        startedAt: null,
        metrics: { observed: { orchestratorInvocations: 0 } },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('propaga um WorkflowResult cancelado como erro terminal', async () => {
    const cancelled = createTerminalWorkflowResultFixture(successfulWorkflow, 'CANCELLED');
    const error = await createExecutionEngine({
      orchestrator: { execute: async () => cancelled },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionEngineError);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.CANCELLED,
      result: { status: 'CANCELLED', workflowResult: cancelled },
    });
  });

  it('rejeita contrato ou correlação inválidos na fronteira pública', async () => {
    const malformed = await createExecutionEngine({
      orchestrator: { execute: async () => ({}) as WorkflowResult },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);
    const mismatched: WorkflowResult = {
      ...structuredClone(successfulWorkflow),
      workflowId: 'workflow-mismatch',
    };
    const mismatch = await createExecutionEngine({
      orchestrator: { execute: async () => mismatched },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(malformed).toMatchObject({ code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION });
    expect(mismatch).toMatchObject({ code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION });
  });

  it('rejeita configuração e request inválidos sem criar execução', async () => {
    expect(() => createExecutionEngine({ orchestrator: null as never })).toThrowError(
      expect.objectContaining({ code: EXECUTION_ENGINE_ERROR_CODES.INVALID_CONFIGURATION }),
    );
    const error = await createExecutionEngine({
      orchestrator: { execute: async () => successfulWorkflow },
    })
      .execute({} as ExecutionRequest)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.INVALID_REQUEST,
      result: undefined,
    });
  });

  it('sanitiza fonte temporal inválida antes de criar o ciclo', async () => {
    const error = await createExecutionEngine({
      orchestrator: { execute: async () => successfulWorkflow },
      now: () => Number.NaN,
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ExecutionEngineError);
    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.INTERNAL_ERROR,
      state: 'CREATED',
      result: undefined,
    });
  });

  it('rejeita resultado parcial inválido carregado por OrchestratorError', async () => {
    const error = await createExecutionEngine({
      orchestrator: {
        execute: async () => {
          throw new OrchestratorError('interno', {
            code: ORCHESTRATOR_ERROR_CODES.INTERNAL_ERROR,
            stage: 'INITIALIZATION',
            durationMs: 1,
            result: {} as WorkflowResult,
          });
        },
      },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(),
    })
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: EXECUTION_ENGINE_ERROR_CODES.CONTRACT_VIOLATION,
      result: { status: 'FAILED', workflowResult: null },
    });
  });
});

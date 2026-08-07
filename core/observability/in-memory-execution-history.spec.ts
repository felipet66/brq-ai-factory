import { describe, expect, it } from 'vitest';

import { OBSERVABILITY_ERROR_CODES, ObservabilityError } from './errors';
import {
  MAX_EXECUTION_HISTORY_ENTRIES,
  createInMemoryExecutionHistory,
} from './in-memory-execution-history';
import {
  createObservabilityRequest,
  createSuccessfulExecutionResult,
  fixedClock,
} from './testing/observability-fixtures';

describe('In-memory execution history', () => {
  it('registra a ordem canônica, métricas e summary sem recalcular hashes', async () => {
    const request = createObservabilityRequest();
    const result = await createSuccessfulExecutionResult(request);
    const history = createInMemoryExecutionHistory({ now: fixedClock() });
    history.begin(request);
    const base = { workflowId: request.workflowId, executionId: result.executionId };

    history.capture('info', 'execution.created', base);
    history.capture('info', 'execution.started', base);
    expect(history.get(request.workflowId)?.status).toBe('RUNNING');
    history.capture('info', 'product_owner.agent.started', {
      ...base,
      agentExecutionId: request.agents.productOwner.agentExecutionId,
    });
    history.capture('info', 'product_owner.knowledge.loaded', {
      ...base,
      agentExecutionId: request.agents.productOwner.agentExecutionId,
    });
    history.capture('info', 'agent.run.completed', {
      ...base,
      agent: 'PRODUCT_OWNER',
      promptBytes: 12_000,
      bytesReceived: 2_000,
      usageInputCount: 300,
      usageOutputCount: 100,
      providerDurationMs: 25,
    });
    history.capture('info', 'response.validation.accepted', {
      ...base,
      agentExecutionId: request.agents.productOwner.agentExecutionId,
      durationMs: 4,
    });
    history.capture('info', 'artifact.generation.completed', {
      ...base,
      agentExecutionId: request.agents.productOwner.agentExecutionId,
      durationMs: 3,
    });
    history.capture('info', 'workflow.stage.completed', {
      ...base,
      stage: 'PRODUCT_OWNER',
      durationMs: 50,
    });
    for (const stage of ['DEVELOPER', 'QA'] as const) {
      history.capture('info', 'workflow.stage.started', { ...base, stage });
      history.capture('info', 'workflow.stage.completed', { ...base, stage, durationMs: 40 });
    }
    history.capture('info', 'execution.completed', { ...base, durationMs: 150 });
    history.complete(result);

    const snapshot = history.get(result.executionId)!;
    expect(snapshot.status).toBe('SUCCESS');
    expect(snapshot.stages.map(({ stageId, status }) => [stageId, status])).toEqual([
      ['KNOWLEDGE', 'SUCCESS'],
      ['PRODUCT_OWNER', 'SUCCESS'],
      ['DEVELOPER', 'SUCCESS'],
      ['QA', 'SUCCESS'],
    ]);
    expect(snapshot.events.map((event) => `${event.type}:${event.stageId}`)).toEqual([
      'execution.started:EXECUTION',
      'stage.started:KNOWLEDGE',
      'stage.finished:KNOWLEDGE',
      'stage.started:PRODUCT_OWNER',
      'stage.finished:PRODUCT_OWNER',
      'stage.started:DEVELOPER',
      'stage.finished:DEVELOPER',
      'stage.started:QA',
      'stage.finished:QA',
      'execution.finished:WORKFLOW',
    ]);
    expect(snapshot.stageMetrics[0]).toMatchObject({
      stageId: 'PRODUCT_OWNER',
      validationDurationMs: 4,
      artifactGenerationDurationMs: 3,
    });
    expect(snapshot.summary).toMatchObject({
      executionId: result.executionId,
      workflowStatus: 'SUCCESS',
      totalCostEstimate: null,
      hashes: result.hashes,
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
    });
    expect(snapshot.summary!.totalTokens).toBeGreaterThan(0);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.events)).toBe(true);
    expect(history.get(request.workflowId)).toBeNull();
  });

  it('marca a etapa com falha e as posteriores como ignoradas', () => {
    const request = createObservabilityRequest();
    const history = createInMemoryExecutionHistory({ now: fixedClock() });
    const executionId = `execution-${'b'.repeat(32)}`;
    const base = { workflowId: request.workflowId, executionId };
    history.begin(request);
    history.capture('info', 'execution.created', base);
    history.capture('info', 'execution.started', base);
    history.capture('info', 'product_owner.agent.started', base);
    history.capture('info', 'product_owner.knowledge.loaded', base);
    history.capture('info', 'workflow.stage.completed', { ...base, stage: 'PRODUCT_OWNER' });
    history.capture('info', 'workflow.stage.started', { ...base, stage: 'DEVELOPER' });
    history.capture('error', 'workflow.failed', {
      ...base,
      stage: 'DEVELOPER',
      error: { code: 'ORCHESTRATOR_DEVELOPER_FAILED' },
    });
    history.capture('error', 'execution.failed', {
      ...base,
      durationMs: 80,
      error: { code: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED' },
    });

    const snapshot = history.get(executionId)!;
    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.stages.find((stage) => stage.stageId === 'DEVELOPER')?.status).toBe('FAILED');
    expect(snapshot.stages.find((stage) => stage.stageId === 'QA')?.status).toBe('SKIPPED');
    expect(snapshot.events.at(-1)).toMatchObject({
      type: 'execution.failed',
      status: 'FAILED',
      errorCode: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
    });
    expect(snapshot.summary).toBeNull();
  });

  it('representa cancelamento sem iniciar etapas posteriores', () => {
    const request = createObservabilityRequest();
    const history = createInMemoryExecutionHistory({ now: fixedClock() });
    const executionId = `execution-${'c'.repeat(32)}`;
    const base = { workflowId: request.workflowId, executionId };
    history.begin(request);
    history.capture('info', 'execution.created', base);
    history.capture('info', 'execution.started', base);
    history.capture('warn', 'workflow.cancelled', base);
    history.capture('warn', 'execution.cancelled', { ...base, durationMs: 10 });

    const snapshot = history.get(executionId)!;
    expect(snapshot.status).toBe('CANCELLED');
    expect(snapshot.stages.every((stage) => stage.status === 'SKIPPED')).toBe(true);
    expect(snapshot.events.at(-1)).toMatchObject({ type: 'execution.failed', status: 'CANCELLED' });
  });

  it('limita a capacidade e remove aliases da execução mais antiga', () => {
    const history = createInMemoryExecutionHistory({ maxEntries: 1, now: fixedClock() });
    const first = createObservabilityRequest();
    const firstExecutionId = `execution-${'d'.repeat(32)}`;
    history.begin(first);
    history.capture('info', 'execution.started', {
      workflowId: first.workflowId,
      executionId: firstExecutionId,
    });
    history.capture('info', 'execution.completed', {
      workflowId: first.workflowId,
      executionId: firstExecutionId,
      durationMs: 10,
    });
    const second = createObservabilityRequest({
      workflowId: 'workflow-22222222-2222-4222-8222-222222222222',
      requestId: 'request-22222222-2222-4222-8222-222222222222',
    });
    history.begin(second);
    expect(history.get(first.workflowId)).toBeNull();
    expect(history.get(firstExecutionId)).toBeNull();
  });

  it('preserva uma execução ativa quando a capacidade está ocupada', () => {
    const history = createInMemoryExecutionHistory({ maxEntries: 1, now: fixedClock() });
    const first = createObservabilityRequest();
    const firstExecutionId = `execution-${'e'.repeat(32)}`;
    history.begin(first);
    history.capture('info', 'execution.started', {
      workflowId: first.workflowId,
      executionId: firstExecutionId,
    });

    const second = createObservabilityRequest({
      workflowId: 'workflow-22222222-2222-4222-8222-222222222222',
      requestId: 'request-22222222-2222-4222-8222-222222222222',
    });
    history.begin(second);

    expect(history.get(firstExecutionId)?.status).toBe('RUNNING');
    expect(history.get(second.workflowId)).toBeNull();
  });

  it('rejeita capacidade fora dos limites', () => {
    expect(() => createInMemoryExecutionHistory({ maxEntries: 0 })).toThrowError(
      expect.objectContaining<Partial<ObservabilityError>>({
        code: OBSERVABILITY_ERROR_CODES.INVALID_CONFIGURATION,
      }),
    );
    expect(() =>
      createInMemoryExecutionHistory({ maxEntries: MAX_EXECUTION_HISTORY_ENTRIES + 1 }),
    ).toThrow(ObservabilityError);
  });

  it('ignora eventos desconhecidos antes de criar aliases ou avançar o relógio', () => {
    const history = createInMemoryExecutionHistory({ now: fixedClock() });
    const request = createObservabilityRequest();
    const executionId = `execution-${'f'.repeat(32)}`;
    history.begin(request);
    history.capture('info', 'unknown.event', {
      workflowId: request.workflowId,
      executionId,
      prompt: 'must-not-be-retained',
    });
    expect(history.get(executionId)).toBeNull();

    history.capture('info', 'execution.started', { workflowId: request.workflowId, executionId });
    expect(history.get(executionId)?.events[0]?.startedAt).toBe('1970-01-01T00:00:01.020Z');
  });

  it('não permite que um executionId inválido contamine o registro', () => {
    const history = createInMemoryExecutionHistory({ now: () => Number.NaN });
    const request = createObservabilityRequest();
    history.begin(request);
    history.capture('info', 'execution.started', {
      workflowId: request.workflowId,
      executionId: 'execution-invalid',
    });

    expect(history.get('execution-invalid')).toBeNull();
    expect(history.get(request.workflowId)).toBeNull();
  });
});

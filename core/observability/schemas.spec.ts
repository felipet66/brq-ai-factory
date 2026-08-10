import { describe, expect, it } from 'vitest';

import {
  executionObservabilityEventSchema,
  executionObservabilitySnapshotSchema,
  executionStageMetricsSchema,
} from './schemas';

const EXECUTION_ID = `execution-${'a'.repeat(32)}`;

function validStages() {
  return [
    ['KNOWLEDGE', 'Knowledge'],
    ['PRODUCT_OWNER', 'Product Owner'],
    ['DEVELOPER', 'Developer'],
    ['QA', 'QA'],
  ].map(([stageId, stageName]) => ({
    stageId,
    stageName,
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    requestId: null,
    executionId: EXECUTION_ID,
  }));
}

function validMetrics() {
  return ['PRODUCT_OWNER', 'DEVELOPER', 'QA'].map((stageId) => ({
    stageId,
    durationMs: null,
    promptBytes: null,
    completionBytes: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    providerLatencyMs: null,
    validationDurationMs: null,
    artifactGenerationDurationMs: null,
  }));
}

function validFactoryStages() {
  return [
    ['KNOWLEDGE', 'Knowledge'],
    ['PRODUCT_OWNER', 'Product Owner'],
    ['DEVELOPER', 'Developer'],
    ['QA', 'QA'],
    ['CODE_GENERATOR', 'Code Generator'],
    ['WORKSPACE', 'Workspace'],
    ['SANDBOX_PREPARE', 'Sandbox Prepare'],
    ['SANDBOX_TYPECHECK', 'Sandbox Typecheck'],
    ['SANDBOX_BUILD', 'Sandbox Build'],
    ['SANDBOX_TEST', 'Sandbox Test'],
  ].map(([stageId, stageName]) => ({
    stageId,
    stageName,
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    requestId: null,
    executionId: EXECUTION_ID,
  }));
}

describe('Observability schemas', () => {
  it('valida evento tipado sem conteúdo sensível', () => {
    expect(
      executionObservabilityEventSchema.parse({
        sequence: 1,
        type: 'stage.started',
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'RUNNING',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        requestId: 'request-test',
        executionId: EXECUTION_ID,
        errorCode: null,
      }),
    ).toMatchObject({ type: 'stage.started', stageId: 'PRODUCT_OWNER' });
  });

  it('rejeita campos de payload não autorizados', () => {
    expect(
      executionObservabilityEventSchema.safeParse({
        sequence: 1,
        type: 'stage.started',
        stageId: 'QA',
        stageName: 'QA',
        status: 'RUNNING',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        requestId: null,
        executionId: EXECUTION_ID,
        errorCode: null,
        prompt: 'secret',
      }).success,
    ).toBe(false);
  });

  it('distingue métricas não observadas de duração zero', () => {
    const parsed = executionStageMetricsSchema.parse({
      stageId: 'DEVELOPER',
      durationMs: 0,
      promptBytes: null,
      completionBytes: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      providerLatencyMs: null,
      validationDurationMs: null,
      artifactGenerationDurationMs: null,
    });
    expect(parsed.durationMs).toBe(0);
    expect(parsed.promptBytes).toBeNull();
  });

  it('rejeita sequência descontínua no snapshot', () => {
    const result = executionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: '1.0.0',
      revision: 1,
      executionId: EXECUTION_ID,
      workflowId: 'workflow-test',
      requestId: null,
      status: 'RUNNING',
      updatedAt: '2026-08-07T10:00:00.000Z',
      events: [
        {
          sequence: 2,
          type: 'execution.started',
          stageId: 'EXECUTION',
          stageName: 'Execution',
          status: 'RUNNING',
          startedAt: '2026-08-07T10:00:00.000Z',
          finishedAt: null,
          durationMs: null,
          requestId: null,
          executionId: EXECUTION_ID,
          errorCode: null,
        },
      ],
      stages: validStages(),
      stageMetrics: validMetrics(),
      summary: null,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'events.0.sequence')).toBe(
      true,
    );
  });

  it('rejeita ordem de etapas e correlação divergentes', () => {
    const stages = validStages();
    [stages[0], stages[1]] = [stages[1]!, stages[0]!];
    stages[2] = { ...stages[2]!, executionId: `execution-${'b'.repeat(32)}` };

    const result = executionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: '1.0.0',
      revision: 1,
      executionId: EXECUTION_ID,
      workflowId: 'workflow-test',
      requestId: null,
      status: 'RUNNING',
      updatedAt: '2026-08-07T10:00:00.000Z',
      events: [],
      stages,
      stageMetrics: validMetrics().reverse(),
      summary: null,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(
      expect.arrayContaining(['stages', 'stageMetrics']),
    );
  });

  it('preserva snapshots v1 e aceita o contrato v2 aditivo da Factory', () => {
    const base = {
      revision: 0,
      executionId: EXECUTION_ID,
      workflowId: 'workflow-test',
      requestId: null,
      status: 'RUNNING',
      updatedAt: '2026-08-07T10:00:00.000Z',
      events: [],
      stageMetrics: validMetrics(),
      summary: null,
    };
    expect(
      executionObservabilitySnapshotSchema.parse({
        ...base,
        observabilityVersion: '1.0.0',
        stages: validStages(),
      }).observabilityVersion,
    ).toBe('1.0.0');
    const factory = executionObservabilitySnapshotSchema.parse({
      ...base,
      observabilityVersion: '2.0.0',
      stages: validFactoryStages(),
    });
    expect(factory.observabilityVersion).toBe('2.0.0');
    expect(factory.stages).toHaveLength(10);
  });

  it('não aceita um payload v1 rotulado como Observability v2', () => {
    const parsed = executionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: '2.0.0',
      revision: 0,
      executionId: EXECUTION_ID,
      workflowId: 'workflow-test',
      requestId: null,
      status: 'RUNNING',
      updatedAt: '2026-08-07T10:00:00.000Z',
      events: [],
      stages: validStages(),
      stageMetrics: validMetrics(),
      summary: null,
    });

    expect(parsed.success).toBe(false);
  });

  it('rejeita drift na ordem pública da Factory sem enfraquecer o v1', () => {
    const stages = validFactoryStages();
    [stages[4], stages[5]] = [stages[5]!, stages[4]!];
    const parsed = executionObservabilitySnapshotSchema.safeParse({
      observabilityVersion: '2.0.0',
      revision: 0,
      executionId: EXECUTION_ID,
      workflowId: 'workflow-test',
      requestId: null,
      status: 'RUNNING',
      updatedAt: '2026-08-07T10:00:00.000Z',
      events: [],
      stages,
      stageMetrics: validMetrics(),
      summary: null,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.some((issue) => issue.path[0] === 'stages')).toBe(true);
  });
});

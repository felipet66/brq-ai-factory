import {
  calculateFactoryPipelineResultHash,
  factoryExecutionResultSchema,
} from '@brq/factory-pipeline';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';
import { describe, expect, it } from 'vitest';

import { createInMemoryFactoryExecutionHistory } from './in-memory-factory-execution-history';
import { createObservabilityRequest, fixedClock } from './testing/observability-fixtures';

const EXECUTION_ID = `execution-${'a'.repeat(32)}`;

describe('In-memory Factory execution history', () => {
  it('mantém o workflow intermediário RUNNING e terminaliza somente com FactoryResult', () => {
    const request = createObservabilityRequest();
    const result = createFactoryExecutionResultFixture({
      executionId: EXECUTION_ID,
      workflowId: request.workflowId,
    });
    const history = createInMemoryFactoryExecutionHistory({ now: fixedClock() });
    const base = { workflowId: request.workflowId, executionId: result.executionId };
    history.beginFactory(request);
    history.capture('info', 'factory.pipeline.started', base);
    history.capture('info', 'product_owner.agent.started', base);
    history.capture('info', 'product_owner.knowledge.loaded', base);
    history.capture('info', 'workflow.stage.completed', {
      ...base,
      stage: 'PRODUCT_OWNER',
      durationMs: 20,
    });
    for (const stage of ['DEVELOPER', 'QA'] as const) {
      history.capture('info', 'workflow.stage.started', { ...base, stage });
      history.capture('info', 'workflow.stage.completed', { ...base, stage, durationMs: 20 });
    }
    history.capture('info', 'agent.run.completed', {
      ...base,
      agent: 'PRODUCT_OWNER',
      promptBytes: 100,
      bytesReceived: 20,
      usageInputCount: 10,
      usageOutputCount: 5,
      providerDurationMs: 3,
    });

    history.capture('info', 'execution.completed', { ...base, durationMs: 80 });
    expect(history.get(result.executionId)?.status).toBe('RUNNING');

    for (const stage of [
      'CODE_GENERATOR',
      'WORKSPACE_PLAN',
      'WORKSPACE_MATERIALIZATION',
      'SANDBOX_PREPARE',
      'SANDBOX_TYPECHECK',
      'SANDBOX_BUILD',
      'SANDBOX_TEST',
      'WORKSPACE_RELEASE',
    ] as const) {
      history.capture('info', 'factory.stage.started', { ...base, stage });
      history.capture('info', 'factory.stage.completed', { ...base, stage, durationMs: 10 });
    }
    history.capture('info', 'factory.pipeline.completed', { ...base, durationMs: 200 });
    expect(history.get(result.executionId)?.status).toBe('RUNNING');

    history.completeFactory(result);
    const snapshot = history.get(result.executionId)!;
    expect(snapshot.observabilityVersion).toBe('2.0.0');
    expect(snapshot.status).toBe('SUCCESS');
    expect(snapshot.stages.map(({ stageId, status }) => [stageId, status])).toEqual([
      ['KNOWLEDGE', 'SUCCESS'],
      ['PRODUCT_OWNER', 'SUCCESS'],
      ['DEVELOPER', 'SUCCESS'],
      ['QA', 'SUCCESS'],
      ['CODE_GENERATOR', 'SUCCESS'],
      ['WORKSPACE', 'SUCCESS'],
      ['SANDBOX_PREPARE', 'SUCCESS'],
      ['SANDBOX_TYPECHECK', 'SUCCESS'],
      ['SANDBOX_BUILD', 'SUCCESS'],
      ['SANDBOX_TEST', 'SUCCESS'],
    ]);
    expect(snapshot.summary).toMatchObject({
      workflowStatus: 'SUCCESS',
      factoryStatus: 'SUCCESS',
      factoryResultHash: result.hashes.factoryResultHash,
      hashes: result.execution.hashes,
      executedStages: snapshot.stages.map((stage) => stage.stageId),
      skippedStages: [],
    });
    expect(snapshot.summary?.totalTokens).toBe(15);
    for (const step of result.sandbox.steps) {
      const stage = snapshot.stages.find(
        (candidate) => candidate.stageId === `SANDBOX_${step.stepId}`,
      );
      expect(stage).toMatchObject({
        status: step.status,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
        durationMs: step.durationMs,
      });
    }
    expect(snapshot.events.at(-1)).toMatchObject({
      type: 'execution.finished',
      stageId: 'FACTORY',
      status: 'SUCCESS',
    });
    expect(snapshot.events.length).toBeLessThanOrEqual(64);
    expect(history.get(request.workflowId)).toBeNull();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('encerra WORKSPACE na materialização e não o reabre durante release', () => {
    const request = createObservabilityRequest();
    const result = createFactoryExecutionResultFixture({
      executionId: EXECUTION_ID,
      workflowId: request.workflowId,
    });
    const history = createInMemoryFactoryExecutionHistory({ now: fixedClock() });
    const base = { workflowId: request.workflowId, executionId: result.executionId };
    history.beginFactory(request);
    history.capture('info', 'factory.pipeline.started', base);
    history.capture('info', 'factory.stage.started', { ...base, stage: 'WORKSPACE_PLAN' });
    history.capture('info', 'factory.stage.completed', { ...base, stage: 'WORKSPACE_PLAN' });
    history.capture('info', 'factory.stage.started', {
      ...base,
      stage: 'WORKSPACE_MATERIALIZATION',
    });
    history.capture('info', 'factory.stage.completed', {
      ...base,
      stage: 'WORKSPACE_MATERIALIZATION',
    });
    const materialized = history
      .get(EXECUTION_ID)!
      .stages.find((stage) => stage.stageId === 'WORKSPACE');
    expect(materialized?.status).toBe('SUCCESS');

    history.capture('info', 'factory.stage.started', { ...base, stage: 'WORKSPACE_RELEASE' });
    history.capture('error', 'factory.stage.failed', {
      ...base,
      stage: 'WORKSPACE_RELEASE',
      error: { code: 'FACTORY_PIPELINE_WORKSPACE_RELEASE_FAILED' },
    });
    expect(
      history.get(EXECUTION_ID)!.stages.find((stage) => stage.stageId === 'WORKSPACE')?.status,
    ).toBe('SUCCESS');
  });

  it('preserva workflow SUCCESS quando uma falha funcional terminal ocorre na sandbox', () => {
    const request = createObservabilityRequest();
    const candidate = structuredClone(
      createFactoryExecutionResultFixture({
        executionId: EXECUTION_ID,
        workflowId: request.workflowId,
      }),
    );
    const sandboxTest = candidate.stages.find((stage) => stage.stageId === 'SANDBOX_TEST')!;
    const failure = {
      code: 'FACTORY_PIPELINE_SANDBOX_FAILED',
      stage: 'SANDBOX_TEST' as const,
      sourceCode: 'SANDBOX_STEP_FAILED',
      message: 'Falha funcional sanitizada.',
    };
    Object.assign(sandboxTest, { status: 'FAILED', outputHash: null, failure });
    Object.assign(candidate, {
      status: 'FAILED',
      terminalStage: 'SANDBOX_TEST',
      failure,
    });
    const { factoryResultHash, ...hashesWithoutResult } = candidate.hashes;
    expect(factoryResultHash).toMatch(/^[a-f0-9]{64}$/u);
    const result = factoryExecutionResultSchema.parse({
      ...candidate,
      hashes: {
        ...hashesWithoutResult,
        factoryResultHash: calculateFactoryPipelineResultHash({
          ...candidate,
          hashes: hashesWithoutResult,
        }),
      },
    });
    const history = createInMemoryFactoryExecutionHistory({ now: fixedClock() });
    history.beginFactory(request);
    history.completeFactory(result);

    const snapshot = history.get(EXECUTION_ID)!;
    expect(snapshot.status).toBe('FAILED');
    expect(snapshot.summary).toMatchObject({
      workflowStatus: 'SUCCESS',
      factoryStatus: 'FAILED',
    });
    expect(snapshot.stages.find((stage) => stage.stageId === 'SANDBOX_BUILD')?.status).toBe(
      'SUCCESS',
    );
    expect(snapshot.stages.find((stage) => stage.stageId === 'SANDBOX_TEST')?.status).toBe(
      'FAILED',
    );
    expect(snapshot.events.at(-1)).toMatchObject({
      type: 'execution.failed',
      stageId: 'FACTORY',
      errorCode: failure.code,
    });
  });
});

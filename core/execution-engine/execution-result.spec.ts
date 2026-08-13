import { createLogger } from '@brq/shared/logger/logger';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ExecutionResult } from './contracts';
import { EXECUTION_CONTRACT_VERSION, createExecutionEngine } from './execution-engine';
import { calculateCanonicalJsonHash, createDeterministicExecutionId } from './hashing';
import { executionResultSchema } from './schemas';
import {
  createExecutionRequestFixture,
  createSuccessfulWorkflowResultFixture,
  createWorkflowRequestForExecution,
  incrementalClock,
} from './testing/execution-engine-fixtures';

describe('ExecutionResult invariants', () => {
  let result: ExecutionResult;

  beforeAll(async () => {
    const request = createExecutionRequestFixture();
    const executionId = createDeterministicExecutionId(
      calculateCanonicalJsonHash(request),
      EXECUTION_CONTRACT_VERSION,
    );
    const workflow = await createSuccessfulWorkflowResultFixture(
      createWorkflowRequestForExecution(request, executionId),
    );
    result = await createExecutionEngine({
      orchestrator: { execute: async () => workflow },
      logger: createLogger({ sink: () => undefined }),
      now: incrementalClock(1_000, 10),
    }).execute(request);
  });

  it('rejeita ordem temporal e timeline incoerentes', () => {
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        startedAt: '2026-01-02T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    const timeline = result.timeline.map((event, index) =>
      index === 1 ? { ...event, sequence: 7, timestampMs: 0 } : { ...event },
    );
    expect(executionResultSchema.safeParse({ ...structuredClone(result), timeline }).success).toBe(
      false,
    );
  });

  it('exige WorkflowResult bem-sucedido e falha de cancelamento coerente', () => {
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        workflowResult: null,
      }).success,
    ).toBe(false);
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        status: 'CANCELLED',
        failure: {
          kind: 'ORCHESTRATOR_ERROR',
          code: 'EXECUTION_ENGINE_ORCHESTRATOR_FAILED',
          sourceCode: null,
          message: 'Falha.',
        },
      }).success,
    ).toBe(false);
  });

  it('rejeita correlação, lineage, provenance e hashes promovidos divergentes', () => {
    const mismatchedWorkflow = {
      ...structuredClone(result.workflowResult!),
      workflowId: 'workflow-mismatch',
    };
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        workflowResult: mismatchedWorkflow,
      }).success,
    ).toBe(false);
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        lineage: null,
      }).success,
    ).toBe(false);
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        hashes: { ...result.hashes, workflowHash: '0'.repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        hashes: { ...result.hashes, workflowRequestHash: '0'.repeat(64) },
      }).success,
    ).toBe(false);
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        metadata: { ...result.metadata, contractVersion: '1.0.0' },
      }).success,
    ).toBe(false);
  });

  it('proíbe dados derivados quando WorkflowResult é nulo', () => {
    expect(
      executionResultSchema.safeParse({
        ...structuredClone(result),
        status: 'FAILED',
        workflowResult: null,
        failure: {
          kind: 'CONTRACT_VIOLATION',
          code: 'EXECUTION_ENGINE_CONTRACT_VIOLATION',
          sourceCode: null,
          message: 'Falha sanitizada.',
        },
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  calculateFactoryPipelineResultHash,
  type FactoryExecutionResult,
} from '@brq/factory-pipeline';
import { createFactoryExecutionResultFixture } from '@brq/factory-pipeline/testing';

import { projectPersistedFactoryResult } from './mapper';
import { createExecutionRecordFixture } from './testing/execution-record-fixtures';
import {
  executionRecordCreatedInputSchema,
  executionRecordJobSchema,
  executionRecordJobTerminalInputSchema,
  executionRecordListQuerySchema,
  executionRecordSchema,
  persistedFactoryResultSchema,
} from './schemas';

describe('execution record schemas', () => {
  it('rejects unknown and sensitive creation fields', () => {
    expect(
      executionRecordCreatedInputSchema.safeParse({
        workflowId: 'workflow-001',
        requestId: null,
        traceId: null,
        projectName: 'Safe title',
        createdAt: '2026-08-07T12:00:00.000Z',
        metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
        prompt: 'must never persist',
      }).success,
    ).toBe(false);
  });

  it('enforces contiguous lifecycle events and terminal identifiers', () => {
    const record = createExecutionRecordFixture();
    expect(
      executionRecordSchema.safeParse({
        ...record,
        lifecycle: record.lifecycle.map((event, index) =>
          index === 1 ? { ...event, sequence: 7 } : event,
        ),
      }).success,
    ).toBe(false);
    expect(executionRecordSchema.safeParse({ ...record, executionId: null }).success).toBe(false);
  });

  it('rejects terminal metadata on active records and mismatched observations', () => {
    const terminal = createExecutionRecordFixture();
    const active = {
      ...terminal,
      status: 'RUNNING',
      workflowStatus: null,
      executionId: terminal.executionId,
      lifecycle: terminal.lifecycle.slice(0, 2),
    };
    expect(executionRecordSchema.safeParse(active).success).toBe(false);
    expect(
      executionRecordSchema.safeParse({
        ...terminal,
        workflowId: 'different-workflow',
      }).success,
    ).toBe(false);
  });

  it('defaults page size and validates date ranges', () => {
    expect(executionRecordListQuerySchema.parse({}).limit).toBe(20);
    expect(
      executionRecordListQuerySchema.safeParse({
        createdAfter: '2026-08-08T00:00:00.000Z',
        createdBefore: '2026-08-07T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('validates the independent queued, running and terminal job lifecycle', () => {
    const queued = {
      jobId: `job-${'a'.repeat(32)}`,
      status: 'QUEUED',
      queuedAt: '2026-08-07T12:00:00.000Z',
      startedAt: null,
      finishedAt: null,
    } as const;
    expect(executionRecordJobSchema.safeParse(queued).success).toBe(true);
    expect(
      executionRecordJobSchema.safeParse({
        ...queued,
        status: 'RUNNING',
        startedAt: null,
      }).success,
    ).toBe(false);
    expect(
      executionRecordJobSchema.safeParse({
        ...queued,
        status: 'FAILED',
        finishedAt: null,
      }).success,
    ).toBe(false);
    expect(
      executionRecordJobTerminalInputSchema.safeParse({
        jobId: queued.jobId,
        status: 'SUCCESS',
        finishedAt: '2026-08-07T12:00:00.010Z',
      }).success,
    ).toBe(true);
  });

  it('mantém o FactoryResult persistido estrito, ordenado e sem payload sensível', () => {
    const factory = projectPersistedFactoryResult(
      createFactoryExecutionResultFixture({
        executionId: `execution-${'f'.repeat(32)}`,
        workflowId: 'workflow-factory',
      }),
    );
    expect(persistedFactoryResultSchema.safeParse(factory).success).toBe(true);
    expect(
      persistedFactoryResultSchema.safeParse({ ...factory, prompt: 'must-not-persist' }).success,
    ).toBe(false);
    const stages = factory.stages.map((stage, index, source) => {
      if (index === 3) return source[4]!;
      if (index === 4) return source[3]!;
      return stage;
    });
    expect(persistedFactoryResultSchema.safeParse({ ...factory, stages }).success).toBe(false);
    expect(factory.lineage).toMatchObject({
      executionProfileHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      generationProjectionHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      profileValidationHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(factory.provenance).toMatchObject({
      executionProfileId: 'NODE_WEB_PREVIEW_24_V1',
      executionProfileVersion: '1.0.0',
      executionProfileContractVersion: '1.0.0',
    });
  });

  it('persists an allowlisted nullable reason without leaking the Sandbox source code', () => {
    const successful = createFactoryExecutionResultFixture({
      executionId: `execution-${'e'.repeat(32)}`,
      workflowId: 'workflow-reason-code',
    });
    const candidate: FactoryExecutionResult = {
      ...successful,
      status: 'FAILED' as const,
      terminalStage: 'SANDBOX_PREPARE' as const,
      failure: {
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'INLINE_ACTIVE_CONTENT',
        stage: 'SANDBOX_PREPARE' as const,
        message: 'A etapa técnica falhou.',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_PREPARE'
          ? {
              ...stage,
              status: 'FAILED' as const,
              failure: {
                code: 'SANDBOX_STEP_FAILED',
                stage: 'SANDBOX_PREPARE' as const,
                sourceCode: null,
                reasonCode: 'INLINE_ACTIVE_CONTENT',
                message: 'A etapa técnica falhou.',
              },
            }
          : stage,
      ),
    };
    const hashes = {
      executionHash: candidate.hashes.executionHash,
      workflowHash: candidate.hashes.workflowHash,
      generationHash: candidate.hashes.generationHash,
      bundleHash: candidate.hashes.bundleHash,
      workspacePlanHash: candidate.hashes.workspacePlanHash,
      workspaceHash: candidate.hashes.workspaceHash,
      sandboxRequestHash: candidate.hashes.sandboxRequestHash,
      sandboxResultHash: candidate.hashes.sandboxResultHash,
      lineageHash: candidate.hashes.lineageHash,
      provenanceHash: candidate.hashes.provenanceHash,
    };
    const failed: FactoryExecutionResult = {
      ...candidate,
      hashes: {
        ...hashes,
        factoryResultHash: calculateFactoryPipelineResultHash({ ...candidate, hashes }),
      },
    };

    const persisted = projectPersistedFactoryResult(failed);

    expect(persisted.failure).toMatchObject({
      code: 'SANDBOX_STEP_FAILED',
      sourceCode: null,
      reasonCode: 'INLINE_ACTIVE_CONTENT',
    });
    expect(persisted.stages.find((stage) => stage.stageId === 'SANDBOX_PREPARE')).toMatchObject({
      failureCode: 'SANDBOX_STEP_FAILED',
      reasonCode: 'INLINE_ACTIVE_CONTENT',
    });
    expect(JSON.stringify(persisted)).not.toContain('EXIT_1');

    expect(
      persistedFactoryResultSchema.safeParse({
        ...persisted,
        failure: persisted.failure === null ? null : { ...persisted.failure, reasonCode: null },
        stages: persisted.stages.map((stage) => ({ ...stage, reasonCode: null })),
        lineage: {
          ...persisted.lineage,
          executionProfileHash: null,
          generationProjectionHash: null,
          profileValidationHash: null,
        },
        provenance: {
          ...persisted.provenance,
          executionProfileId: null,
          executionProfileVersion: null,
          executionProfileContractVersion: null,
          executionProfileHash: null,
          generationProjectionHash: null,
          profileValidationHash: null,
        },
      }).success,
    ).toBe(true);
  });
});

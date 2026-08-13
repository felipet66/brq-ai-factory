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
  persistedProvenanceSchema,
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
      executionProfileVersion: '1.1.0',
      executionProfileContractVersion: '1.1.0',
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
        profileRuleId: null,
        diagnosticSummary: null,
        stage: 'SANDBOX_PREPARE' as const,
        message: 'A etapa técnica falhou.',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_PREPARE'
          ? {
              ...stage,
              status: 'FAILED' as const,
              profileRuleId: null,
              diagnosticSummary: null,
              failure: {
                code: 'SANDBOX_STEP_FAILED',
                stage: 'SANDBOX_PREPARE' as const,
                sourceCode: null,
                reasonCode: 'INLINE_ACTIVE_CONTENT',
                profileRuleId: null,
                diagnosticSummary: null,
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

  it('persists an allowlisted profile rule on the terminal failure and matching stage only', () => {
    const successful = createFactoryExecutionResultFixture({
      executionId: `execution-${'d'.repeat(32)}`,
      workflowId: 'workflow-profile-rule',
    });
    const profileRuleId = 'content.javascript.relative-references' as const;
    const failure = {
      code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
      stage: 'CODE_PROFILE_VALIDATION' as const,
      sourceCode: null,
      reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
      profileRuleId,
      diagnosticSummary: null,
      message: 'O Factory Execution Profile rejeitou o bundle.',
    };
    const candidate = {
      ...successful,
      status: 'FAILED' as const,
      terminalStage: 'CODE_PROFILE_VALIDATION' as const,
      failure,
      stages: successful.stages.map((stage) =>
        stage.stageId === 'CODE_PROFILE_VALIDATION'
          ? { ...stage, status: 'FAILED' as const, profileRuleId, failure }
          : stage,
      ),
    };
    const { factoryResultHash: _factoryResultHash, ...hashes } = candidate.hashes;
    void _factoryResultHash;
    const failed: FactoryExecutionResult = {
      ...candidate,
      hashes: {
        ...hashes,
        factoryResultHash: calculateFactoryPipelineResultHash({ ...candidate, hashes }),
      },
    };

    const persisted = projectPersistedFactoryResult(failed);

    expect(persisted.failure?.profileRuleId).toBe(profileRuleId);
    expect(
      persisted.stages.find((stage) => stage.stageId === 'CODE_PROFILE_VALIDATION')?.profileRuleId,
    ).toBe(profileRuleId);
    expect(
      persisted.stages
        .filter((stage) => stage.stageId !== 'CODE_PROFILE_VALIDATION')
        .every((stage) => stage.profileRuleId === null),
    ).toBe(true);
    expect(JSON.stringify(persisted)).not.toMatch(/\.\.\/|https?:|private literal/iu);

    expect(
      persistedFactoryResultSchema.safeParse({
        ...persisted,
        failure: { ...persisted.failure!, profileRuleId: 'customer.private.literal' },
      }).success,
    ).toBe(false);

    const legacy = {
      ...persisted,
      failure: Object.fromEntries(
        Object.entries(persisted.failure!).filter(([key]) => key !== 'profileRuleId'),
      ),
      stages: persisted.stages.map((stage) =>
        Object.fromEntries(Object.entries(stage).filter(([key]) => key !== 'profileRuleId')),
      ),
    };
    const parsedLegacy = persistedFactoryResultSchema.parse(legacy);
    expect(parsedLegacy.failure?.profileRuleId).toBeNull();
    expect(parsedLegacy.stages.every((stage) => stage.profileRuleId === null)).toBe(true);
  });

  it('persists bounded TypeScript diagnostics and defaults historical records to null', () => {
    const successful = projectPersistedFactoryResult(
      createFactoryExecutionResultFixture({
        executionId: `execution-${'c'.repeat(32)}`,
        workflowId: 'workflow-typescript-diagnostics',
      }),
    );
    const diagnosticSummary = {
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    } as const;
    const failed = {
      ...successful,
      status: 'FAILED' as const,
      terminalStage: 'SANDBOX_TYPECHECK' as const,
      sandboxStatus: 'FAILED' as const,
      failure: {
        kind: 'FACTORY_PIPELINE' as const,
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
        profileRuleId: null,
        diagnosticSummary,
        stageId: 'SANDBOX_TYPECHECK' as const,
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_TYPECHECK'
          ? {
              ...stage,
              status: 'FAILED' as const,
              failureCode: 'SANDBOX_STEP_FAILED',
              reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
              diagnosticSummary,
            }
          : stage,
      ),
    };

    const parsed = persistedFactoryResultSchema.parse(failed);
    expect(parsed.failure?.diagnosticSummary).toEqual(diagnosticSummary);
    expect(
      parsed.stages.find((stage) => stage.stageId === 'SANDBOX_TYPECHECK')?.diagnosticSummary,
    ).toEqual(diagnosticSummary);

    const historical = {
      ...successful,
      failure: successful.failure,
      stages: successful.stages.map((stage) =>
        Object.fromEntries(Object.entries(stage).filter(([key]) => key !== 'diagnosticSummary')),
      ),
    };
    const parsedHistorical = persistedFactoryResultSchema.parse(historical);
    expect(parsedHistorical.failure).toBeNull();
    expect(parsedHistorical.stages.every((stage) => stage.diagnosticSummary === null)).toBe(true);

    expect(
      persistedFactoryResultSchema.safeParse({
        ...failed,
        failure: {
          ...failed.failure,
          diagnosticSummary: { ...diagnosticSummary, diagnosticCodes: [] },
        },
      }).success,
    ).toBe(false);
    expect(
      persistedFactoryResultSchema.safeParse({
        ...failed,
        failure: null,
        stages: failed.stages.map((stage) => ({ ...stage, diagnosticSummary: null })),
      }).success,
    ).toBe(false);
  });

  it('rejects persisted SOURCE evidence that disagrees with the upstream readiness', () => {
    const hash = 'a'.repeat(64);
    const stageBase = {
      executionId: 'execution-001',
      agentVersion: '1.0.0',
      outcome: 'GENERATED' as const,
      assetBundleHash: hash,
      knowledgeContextHash: `sha256:${hash}`,
      promptHash: hash,
      responseHash: hash,
      validationHash: hash,
      generationHash: hash,
      artifactHashes: [],
    };
    const stages = [
      {
        ...stageBase,
        stage: 'PRODUCT_OWNER' as const,
        agent: 'PRODUCT_OWNER' as const,
        agentExecutionId: 'po-001',
        readiness: 'READY',
        readinessDecision: {
          version: '1.0.0' as const,
          readiness: 'READY' as const,
          decisiveFactors: [
            {
              sourceStage: 'PRODUCT_OWNER' as const,
              code: 'NO_LOCAL_READINESS_CONCERNS' as const,
            },
          ],
        },
      },
      {
        ...stageBase,
        stage: 'DEVELOPER' as const,
        agent: 'DEVELOPER' as const,
        agentExecutionId: 'developer-001',
        readiness: 'PARTIALLY_READY',
        readinessDecision: {
          version: '1.0.0' as const,
          readiness: 'PARTIALLY_READY' as const,
          decisiveFactors: [
            {
              sourceStage: 'PRODUCT_OWNER' as const,
              code: 'SOURCE_PARTIALLY_READY' as const,
            },
          ],
        },
      },
    ];

    expect(persistedProvenanceSchema.safeParse({ stages }).success).toBe(false);

    const productOwner = stages[0]!;
    const developer = {
      ...stages[1]!,
      readiness: 'READY',
      readinessDecision: {
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' }],
      },
    };
    expect(
      persistedProvenanceSchema.safeParse({ stages: [productOwner, productOwner] }).success,
    ).toBe(false);
    expect(persistedProvenanceSchema.safeParse({ stages: [developer, productOwner] }).success).toBe(
      false,
    );
    expect(
      persistedProvenanceSchema.safeParse({
        stages: [
          {
            ...productOwner,
            outcome: 'VALIDATION_REJECTED',
            readiness: 'READY',
            readinessDecision: null,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

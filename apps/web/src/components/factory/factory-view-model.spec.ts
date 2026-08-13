import { describe, expect, it, vi } from 'vitest';

import {
  createFactoryViewModel,
  FACTORY_VIEW_MODEL_VERSION,
  toFactoryVisualStatus,
  type FactoryObservabilityEvent,
  type FactoryTimelineSource,
  type FactoryVisualStatus,
} from './factory-view-model';
import {
  FACTORY_EXECUTION_ID,
  FACTORY_HASHES,
  FACTORY_JOB_ID,
  factoryExecutionFixture,
  factoryResultFixture,
  factoryTimelineFixture,
  factoryTimelineV2Fixture,
  factoryTimelineV3Fixture,
} from './factory-view-model.spec.fixtures';

function timelineWithStageStatus(
  stageId: FactoryTimelineSource['stages'][number]['stageId'],
  status: FactoryTimelineSource['stages'][number]['status'],
): FactoryTimelineSource {
  const timeline = factoryTimelineFixture();
  return factoryTimelineFixture({
    stages: timeline.stages.map((stage) =>
      stage.stageId === stageId
        ? {
            ...stage,
            status,
            startedAt: status === 'PENDING' || status === 'SKIPPED' ? null : stage.startedAt,
            finishedAt: ['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(status)
              ? stage.finishedAt
              : null,
          }
        : stage,
    ),
  });
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('FactoryViewModel', () => {
  it('projects a successful factory run through one immutable presentation boundary', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(FACTORY_VIEW_MODEL_VERSION).toBe('2.5.0');
    expect(model.version).toBe(FACTORY_VIEW_MODEL_VERSION);
    expect(model.execution).toMatchObject({
      executionId: FACTORY_EXECUTION_ID,
      workflowId: 'workflow-factory-001',
      jobId: FACTORY_JOB_ID,
      requestId: 'request-factory-001',
      projectName: 'Factory Control Room',
      status: 'SUCCESS',
      readiness: 'READY',
      durationMs: 250,
      timelineRevision: 10,
    });
    expect(model.knowledge).toMatchObject({
      id: 'KNOWLEDGE',
      name: 'Knowledge System',
      status: 'COMPLETED',
      durationMs: 10,
    });
    expect(model.agents.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'PRODUCT_OWNER', status: 'COMPLETED' },
      { id: 'DEVELOPER', status: 'COMPLETED' },
      { id: 'QA', status: 'COMPLETED' },
    ]);
    expect(model.progress).toEqual({
      status: 'SUCCESS',
      knowledgeStatus: 'COMPLETED',
      activeAgentId: null,
      failedAgentId: null,
      completedAgentCount: 3,
      resolvedAgentCount: 3,
      totalAgentCount: 3,
      activeTechnicalStageId: null,
      failedTechnicalStageId: null,
      completedTechnicalStageCount: 0,
      resolvedTechnicalStageCount: 0,
      totalTechnicalStageCount: 0,
      totalTokens: 1725,
      totalCostEstimate: { amount: 0.021, currency: 'USD', rateCardVersion: '1.0.0' },
    });
    expectDeeplyFrozen(model);
  });

  it('adds technical stations only from Factory observability evidence', () => {
    const historical = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });
    const factory = createFactoryViewModel({
      execution: factoryExecutionFixture({ factoryResult: factoryResultFixture() }),
      timeline: factoryTimelineV2Fixture(),
    });

    expect(historical.technicalStages).toEqual([]);
    expect(factory.technicalStages.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'CODE_GENERATOR', status: 'COMPLETED' },
      { id: 'CODE_PROFILE_VALIDATION', status: 'COMPLETED' },
      { id: 'WORKSPACE', status: 'COMPLETED' },
      { id: 'SANDBOX_PREPARE', status: 'COMPLETED' },
      { id: 'SANDBOX_TYPECHECK', status: 'COMPLETED' },
      { id: 'SANDBOX_BUILD', status: 'COMPLETED' },
      { id: 'SANDBOX_TEST', status: 'COMPLETED' },
    ]);
    expect(factory.technicalStages[2]).toMatchObject({
      evidenceSource: 'OBSERVABILITY_V2',
      outputHash: expect.any(String),
      facts: expect.arrayContaining([
        { label: 'Plan', value: 'SUCCESS' },
        { label: 'Materialization', value: 'SUCCESS' },
        { label: 'Release', value: 'RELEASED' },
      ]),
    });
    expect(factory.progress).toMatchObject({
      completedTechnicalStageCount: 7,
      resolvedTechnicalStageCount: 7,
      totalTechnicalStageCount: 7,
      activeTechnicalStageId: null,
      failedTechnicalStageId: null,
    });
    expectDeeplyFrozen(factory.technicalStages);
  });

  it('uses Observability v3 as technical evidence without dropping Code Generator metrics', () => {
    const timeline = factoryTimelineV3Fixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ factoryResult: factoryResultFixture() }),
      timeline,
    });

    expect(model.technicalStages).toHaveLength(7);
    expect(
      model.technicalStages
        .filter((stage) => stage.id !== 'CODE_PROFILE_VALIDATION')
        .every((stage) => stage.evidenceSource === 'OBSERVABILITY_V3'),
    ).toBe(true);
    expect(
      model.technicalStages.find((stage) => stage.id === 'CODE_PROFILE_VALIDATION'),
    ).toMatchObject({ evidenceSource: 'FACTORY_RESULT' });
    expect(timeline.stageMetrics[3]).toMatchObject({
      stageId: 'CODE_GENERATOR',
      totalTokens: 150,
    });
  });

  it('maps v2 Factory terminal evidence into the allowlisted activity feed', () => {
    const timeline = factoryTimelineV2Fixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ factoryResult: factoryResultFixture() }),
      timeline: factoryTimelineV2Fixture({
        events: [
          ...timeline.events,
          {
            sequence: timeline.events.length + 1,
            type: 'execution.finished',
            stageId: 'FACTORY',
            stageName: 'Factory',
            status: 'SUCCESS',
            startedAt: '2026-08-08T10:00:00.000Z',
            finishedAt: '2026-08-08T10:00:00.850Z',
            durationMs: 850,
            requestId: 'request-factory-001',
            executionId: FACTORY_EXECUTION_ID,
            errorCode: null,
          },
        ],
      }),
    });

    expect(model.activity.at(-1)).toMatchObject({
      stageId: 'FACTORY',
      label: 'Factory pipeline finished',
      status: 'SUCCESS',
    });
  });

  it('renders failed and skipped technical states from v2 without inventing a live phase', () => {
    const timeline = factoryTimelineV2Fixture();
    const stages = timeline.stages.map((stage) =>
      stage.stageId === 'SANDBOX_BUILD'
        ? { ...stage, status: 'FAILED' as const }
        : stage.stageId === 'SANDBOX_TEST'
          ? {
              ...stage,
              status: 'SKIPPED' as const,
              startedAt: null,
              durationMs: null,
            }
          : stage,
    ) as FactoryTimelineSource['stages'];
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({ status: 'FAILED' }),
      }),
      timeline: factoryTimelineV2Fixture({ status: 'FAILED', stages }),
    });

    expect(model.technicalStages.find((stage) => stage.id === 'SANDBOX_BUILD')?.status).toBe(
      'FAILED',
    );
    expect(model.technicalStages.find((stage) => stage.id === 'SANDBOX_TEST')?.status).toBe(
      'SKIPPED',
    );
    expect(model.progress.failedTechnicalStageId).toBe('SANDBOX_BUILD');
    expect(JSON.stringify(model)).not.toMatch(/sourceCode|stdout|stderr|filesystem|containerId/);
  });

  it('projects the safe reason separately and never exposes the internal EXIT_1 diagnostic', () => {
    const successful = factoryResultFixture();
    const factoryResult = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'SANDBOX_PREPARE',
      sandboxStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'INLINE_ACTIVE_CONTENT',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'SANDBOX_PREPARE',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_PREPARE'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'SANDBOX_STEP_FAILED',
              reasonCode: 'INLINE_ACTIVE_CONTENT',
            }
          : stage,
      ),
    });
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ status: 'FAILED', factoryResult }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(model.technicalStages.find((stage) => stage.id === 'SANDBOX_PREPARE')).toMatchObject({
      failureCode: 'SANDBOX_STEP_FAILED',
      reasonCode: 'INLINE_ACTIVE_CONTENT',
    });
    expect(JSON.stringify(model)).not.toMatch(/EXIT_1|stdout|stderr/u);
  });

  it('projects bounded TypeScript diagnostic count and codes only for failed typecheck', () => {
    const successful = factoryResultFixture();
    const diagnosticSummary = {
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    } as const;
    const factoryResult = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'SANDBOX_TYPECHECK',
      sandboxStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'SANDBOX_STEP_FAILED',
        sourceCode: null,
        reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
        profileRuleId: null,
        diagnosticSummary,
        stageId: 'SANDBOX_TYPECHECK',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'SANDBOX_TYPECHECK'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'SANDBOX_STEP_FAILED',
              reasonCode: 'TYPESCRIPT_DIAGNOSTICS',
              diagnosticSummary,
            }
          : stage,
      ),
    });
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ status: 'FAILED', factoryResult }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(
      model.technicalStages.find((stage) => stage.id === 'SANDBOX_TYPECHECK')?.diagnosticSummary,
    ).toEqual(diagnosticSummary);

    const expanded = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          ...factoryResult,
          stages: factoryResult.stages.map((stage) =>
            stage.stageId === 'SANDBOX_TYPECHECK'
              ? {
                  ...stage,
                  diagnosticSummary: {
                    ...diagnosticSummary,
                    path: '/private/workspace/src/index.ts',
                  } as never,
                }
              : stage,
          ),
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    expect(
      expanded.technicalStages.find((stage) => stage.id === 'SANDBOX_TYPECHECK')?.diagnosticSummary,
    ).toBeNull();
    expect(JSON.stringify(expanded)).not.toMatch(/private workspace|index\.ts/iu);
  });

  it('projects only an allowlisted rule actually recorded for failed Profile Validation', () => {
    const successful = factoryResultFixture();
    const profileFailure = {
      kind: 'FACTORY_PIPELINE' as const,
      code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
      sourceCode: null,
      reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
      profileRuleId: 'content.javascript.relative-references' as const,
      diagnosticSummary: null,
      stageId: 'CODE_PROFILE_VALIDATION' as const,
    };
    const stages = successful.stages.map((stage) =>
      stage.stageId === 'CODE_PROFILE_VALIDATION'
        ? {
            ...stage,
            status: 'FAILED' as const,
            failureCode: profileFailure.code,
            reasonCode: profileFailure.reasonCode,
            profileRuleId: profileFailure.profileRuleId,
          }
        : stage,
    );
    const recorded = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_PROFILE_VALIDATION',
          failure: profileFailure,
          stages,
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(
      recorded.technicalStages.find((stage) => stage.id === 'CODE_PROFILE_VALIDATION'),
    ).toMatchObject({
      status: 'FAILED',
      reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
      profileRuleId: 'content.javascript.relative-references',
    });

    const fallback = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_PROFILE_VALIDATION',
          failure: profileFailure,
          stages: stages.map((stage) =>
            stage.stageId === 'CODE_PROFILE_VALIDATION' ? { ...stage, profileRuleId: null } : stage,
          ),
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    expect(
      fallback.technicalStages.find((stage) => stage.id === 'CODE_PROFILE_VALIDATION')
        ?.profileRuleId,
    ).toBe('content.javascript.relative-references');

    const unknownRule = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_PROFILE_VALIDATION',
          failure: { ...profileFailure, profileRuleId: 'internal.customer.rule' as never },
          stages: stages.map((stage) =>
            stage.stageId === 'CODE_PROFILE_VALIDATION'
              ? { ...stage, profileRuleId: 'internal.customer.rule' as never }
              : stage,
          ),
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    expect(
      unknownRule.technicalStages.find((stage) => stage.id === 'CODE_PROFILE_VALIDATION')
        ?.profileRuleId,
    ).toBeNull();
    expect(JSON.stringify(unknownRule)).not.toContain('internal.customer.rule');

    const unrelatedTerminal = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: factoryResultFixture({
          status: 'FAILED',
          terminalStage: 'CODE_GENERATOR',
          failure: { ...profileFailure, stageId: 'CODE_GENERATOR' },
          stages: stages.map((stage) => ({ ...stage, profileRuleId: null })),
        }),
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });
    expect(
      unrelatedTerminal.technicalStages.find((stage) => stage.id === 'CODE_PROFILE_VALIDATION')
        ?.profileRuleId,
    ).toBeNull();
  });

  it.each<[FactoryTimelineSource['stages'][number]['status'], FactoryVisualStatus]>([
    ['PENDING', 'WAITING'],
    ['RUNNING', 'WORKING'],
    ['SUCCESS', 'COMPLETED'],
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'CANCELLED'],
    ['SKIPPED', 'SKIPPED'],
  ])('maps only the evidenced %s timeline state to %s', (source, expected) => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: timelineWithStageStatus('DEVELOPER', source),
    });

    expect(model.agents[1]).toMatchObject({ sourceStatus: source, status: expected });
    expect(toFactoryVisualStatus(source)).toBe(expected);
  });

  it('keeps all live agent states absent when no timeline has been observed', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'CREATED',
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        job: {
          jobId: FACTORY_JOB_ID,
          status: 'QUEUED',
          queuedAt: '2026-08-08T09:59:59.500Z',
          startedAt: null,
          finishedAt: null,
        },
      }),
      timeline: null,
    });

    expect(model.execution.status).toBe('QUEUED');
    expect(model.execution.startedAt).toBeNull();
    expect(model.knowledge.status).toBe('WAITING');
    expect(model.agents.every((agent) => agent.status === 'WAITING')).toBe(true);
    expect(model.progress).toMatchObject({
      status: 'QUEUED',
      activeAgentId: null,
      completedAgentCount: 0,
      resolvedAgentCount: 0,
    });
  });

  it('uses NOT_OBSERVED for terminal execution metadata that has no timeline evidence', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: null,
    });

    expect(model.execution.status).toBe('SUCCESS');
    expect(model.knowledge.status).toBe('NOT_OBSERVED');
    expect(model.agents.every((agent) => agent.status === 'NOT_OBSERVED')).toBe(true);
    expect(model.handoffs.every((handoff) => handoff.status === 'VERIFIED')).toBe(true);
  });

  it('identifies the only agent actually working without inventing granular phases', () => {
    const timeline = timelineWithStageStatus('DEVELOPER', 'RUNNING');
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'RUNNING',
        finishedAt: null,
        durationMs: null,
        job: {
          jobId: FACTORY_JOB_ID,
          status: 'RUNNING',
          queuedAt: '2026-08-08T09:59:59.500Z',
          startedAt: '2026-08-08T09:59:59.900Z',
          finishedAt: null,
        },
      }),
      timeline: {
        ...timeline,
        status: 'RUNNING',
        summary: null,
        stages: timeline.stages.map((stage) =>
          stage.stageId === 'QA'
            ? { ...stage, status: 'PENDING', startedAt: null, finishedAt: null, durationMs: null }
            : stage,
        ),
      },
    });

    expect(model.progress.activeAgentId).toBe('DEVELOPER');
    expect(model.agents[2].status).toBe('WAITING');
    expect(JSON.stringify(model)).not.toMatch(/PREPARING|VALIDATING|GENERATING_ARTIFACTS/);
  });

  it('maps evidence-backed input and output hashes for each agent', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(model.agents[0].hashes.inputs).toEqual([
      { kind: 'EXECUTION_REQUEST', hash: FACTORY_HASHES.executionRequest },
      { kind: 'WORKFLOW_REQUEST', hash: FACTORY_HASHES.workflowRequest },
    ]);
    expect(model.agents[1].hashes.inputs).toEqual([
      {
        kind: 'PRODUCT_OWNER_SPECIFICATION',
        hash: FACTORY_HASHES.productOwnerSpecification,
      },
    ]);
    expect(model.agents[2].hashes.inputs).toEqual([
      {
        kind: 'PRODUCT_OWNER_SPECIFICATION',
        hash: FACTORY_HASHES.productOwnerSpecification,
      },
      { kind: 'TECHNICAL_SPECIFICATION', hash: FACTORY_HASHES.technicalSpecification },
    ]);
    expect(model.agents.map((agent) => agent.hashes.output)).toEqual([
      {
        kind: 'PRODUCT_OWNER_SPECIFICATION',
        hash: FACTORY_HASHES.productOwnerSpecification,
      },
      { kind: 'TECHNICAL_SPECIFICATION', hash: FACTORY_HASHES.technicalSpecification },
      { kind: 'QA_SPECIFICATION', hash: FACTORY_HASHES.qaSpecification },
    ]);
  });

  it('keeps artifacts hash-only without inventing filenames, media types, or content', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(model.agents.flatMap((agent) => agent.artifacts)).toEqual([
      {
        id: `PRODUCT_OWNER:1:${FACTORY_HASHES.productOwnerArtifact}`,
        ordinal: 1,
        stageId: 'PRODUCT_OWNER',
        hash: FACTORY_HASHES.productOwnerArtifact,
        status: 'RECORDED',
        outcome: 'GENERATED',
        generationHash: FACTORY_HASHES.common,
      },
      {
        id: `DEVELOPER:1:${FACTORY_HASHES.developerArtifact}`,
        ordinal: 1,
        stageId: 'DEVELOPER',
        hash: FACTORY_HASHES.developerArtifact,
        status: 'RECORDED',
        outcome: 'GENERATED',
        generationHash: FACTORY_HASHES.common,
      },
      {
        id: `QA:1:${FACTORY_HASHES.qaArtifact}`,
        ordinal: 1,
        stageId: 'QA',
        hash: FACTORY_HASHES.qaArtifact,
        status: 'RECORDED',
        outcome: 'GENERATED',
        generationHash: FACTORY_HASHES.common,
      },
    ]);
    const serialized = JSON.stringify(model.agents.flatMap((agent) => agent.artifacts));
    expect(serialized).not.toMatch(/filename|mediaType|content|\.md/);
  });

  it('preserves a validation-rejected outcome without changing timeline authority', () => {
    const execution = factoryExecutionFixture();
    const developer = execution.provenance!.stages[1]!;
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        provenance: {
          stages: execution.provenance!.stages.map((stage) =>
            stage.stage === 'DEVELOPER'
              ? {
                  ...developer,
                  outcome: 'VALIDATION_REJECTED',
                  readiness: null,
                  readinessDecision: null,
                  hashes: { ...developer.hashes, generationHash: null, artifactHashes: [] },
                }
              : stage,
          ),
        },
      }),
      timeline: timelineWithStageStatus('DEVELOPER', 'FAILED'),
    });

    expect(model.agents[1]).toMatchObject({
      status: 'FAILED',
      sourceStatus: 'FAILED',
      outcome: 'VALIDATION_REJECTED',
      readiness: null,
      artifacts: [],
    });
    expect(model.progress.failedAgentId).toBe('DEVELOPER');
  });

  it('maps verified primary and supplemental lineage without fabricating a transfer time', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(model.handoffs).toMatchObject([
      {
        id: 'PRODUCT_OWNER_TO_DEVELOPER',
        kind: 'PRIMARY',
        status: 'VERIFIED',
        hash: FACTORY_HASHES.productOwnerSpecification,
        observedAt: '2026-08-08T10:00:00.100Z',
        timestampBasis: 'TARGET_STARTED_AT',
      },
      {
        id: 'DEVELOPER_TO_QA',
        kind: 'PRIMARY',
        status: 'VERIFIED',
        hash: FACTORY_HASHES.technicalSpecification,
        observedAt: '2026-08-08T10:00:00.200Z',
        timestampBasis: 'TARGET_STARTED_AT',
      },
      {
        id: 'PRODUCT_OWNER_TO_QA',
        kind: 'SUPPLEMENTAL',
        status: 'VERIFIED',
        hash: FACTORY_HASHES.productOwnerSpecification,
        observedAt: '2026-08-08T10:00:00.200Z',
        timestampBasis: 'TARGET_STARTED_AT',
      },
    ]);
  });

  it('distinguishes observed, pending, and blocked handoffs from real stage evidence', () => {
    const execution = factoryExecutionFixture({
      lineage: {
        outputs: factoryExecutionFixture().lineage!.outputs,
        handoffs: [],
      },
    });
    const successful = factoryTimelineFixture();
    const observed = createFactoryViewModel({ execution, timeline: successful });
    expect(observed.handoffs.map((handoff) => handoff.status)).toEqual([
      'OBSERVED',
      'OBSERVED',
      'OBSERVED',
    ]);
    expect(observed.handoffs.every((handoff) => handoff.hash === null)).toBe(true);

    const pendingTimeline = factoryTimelineFixture({
      status: 'RUNNING',
      summary: null,
      stages: successful.stages.map((stage) =>
        stage.stageId === 'PRODUCT_OWNER' || stage.stageId === 'DEVELOPER' || stage.stageId === 'QA'
          ? { ...stage, status: 'PENDING', startedAt: null, finishedAt: null, durationMs: null }
          : stage,
      ),
    });
    const pending = createFactoryViewModel({ execution, timeline: pendingTimeline });
    expect(pending.handoffs.every((handoff) => handoff.status === 'PENDING')).toBe(true);

    const failedTimeline = timelineWithStageStatus('PRODUCT_OWNER', 'FAILED');
    const blocked = createFactoryViewModel({ execution, timeline: failedTimeline });
    expect(blocked.handoffs[0].status).toBe('BLOCKED');
    expect(blocked.handoffs[2].status).toBe('BLOCKED');
  });

  it('uses a source completion timestamp only as an explicitly labelled observation fallback', () => {
    const timeline = factoryTimelineFixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: {
        ...timeline,
        stages: timeline.stages.map((stage) =>
          stage.stageId === 'DEVELOPER'
            ? { ...stage, status: 'PENDING', startedAt: null, finishedAt: null, durationMs: null }
            : stage,
        ),
      },
    });

    expect(model.handoffs[0]).toMatchObject({
      status: 'VERIFIED',
      observedAt: '2026-08-08T10:00:00.100Z',
      timestampBasis: 'SOURCE_FINISHED_AT',
    });
  });

  it('builds a stable allowlisted activity feed from job metadata and events only', () => {
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    });

    expect(model.activity.map((activity) => activity.label)).toEqual([
      'Execution queued',
      'Job started',
      'Execution started',
      'Knowledge loading started',
      'Knowledge loaded',
      'Product Owner started',
      'Product Owner finished',
      'Developer started',
      'Developer finished',
      'QA started',
      'Job finished',
      'QA finished',
      'Execution finished',
    ]);
    expect(model.activity.every((activity) => Object.isFrozen(activity))).toBe(true);
  });

  it.each([
    {
      type: 'execution.finished',
      status: 'SUCCESS',
      kind: 'EXECUTION_FINISHED',
      label: 'Execution finished',
    },
    {
      type: 'execution.failed',
      status: 'FAILED',
      kind: 'EXECUTION_FAILED',
      label: 'Execution failed',
    },
    {
      type: 'execution.failed',
      status: 'CANCELLED',
      kind: 'EXECUTION_CANCELLED',
      label: 'Execution cancelled',
    },
  ] as const)(
    'accepts the real terminal $type event emitted on WORKFLOW',
    ({ type, status, kind, label }) => {
      const base = factoryTimelineFixture().events.at(-1)!;
      const event = {
        ...base,
        type,
        status,
        stageId: 'WORKFLOW',
      } satisfies FactoryObservabilityEvent;
      const model = createFactoryViewModel({
        execution: factoryExecutionFixture({ job: null }),
        timeline: factoryTimelineFixture({ events: [event] }),
      });

      expect(model.activity).toEqual([
        expect.objectContaining({
          source: 'OBSERVABILITY_EVENT',
          stageId: 'WORKFLOW',
          kind,
          label,
        }),
      ]);
    },
  );

  it('does not surface raw stage names, error codes, or unknown event types', () => {
    const timeline = factoryTimelineFixture();
    const suspiciousEvents = [
      {
        ...timeline.events[0]!,
        stageName: 'SECRET PROMPT CONTENT',
        errorCode: 'SECRET_INTERNAL_DIAGNOSTIC',
      },
      {
        ...timeline.events[1]!,
        sequence: 2,
        type: 'prompt.prepared',
        stageName: 'SECRET KNOWLEDGE CONTENT',
      } as unknown as FactoryObservabilityEvent,
    ];
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture({ events: suspiciousEvents }),
    });
    const serialized = JSON.stringify(model.activity);

    expect(
      model.activity.filter((activity) => activity.source === 'OBSERVABILITY_EVENT'),
    ).toHaveLength(1);
    expect(serialized).not.toMatch(/SECRET|prompt\.prepared/);
    expect(
      model.activity.find((activity) => activity.source === 'OBSERVABILITY_EVENT')?.label,
    ).toBe('Execution started');
  });

  it.each([
    {
      type: 'execution.failed',
      stageId: 'EXECUTION',
      status: 'FAILED',
      expectedKind: 'EXECUTION_FAILED',
      expectedLabel: 'Execution failed',
    },
    {
      type: 'execution.failed',
      stageId: 'EXECUTION',
      status: 'CANCELLED',
      expectedKind: 'EXECUTION_CANCELLED',
      expectedLabel: 'Execution cancelled',
    },
    {
      type: 'stage.failed',
      stageId: 'QA',
      status: 'FAILED',
      expectedKind: 'STAGE_FAILED',
      expectedLabel: 'QA failed',
    },
    {
      type: 'stage.failed',
      stageId: 'QA',
      status: 'CANCELLED',
      expectedKind: 'STAGE_CANCELLED',
      expectedLabel: 'QA cancelled',
    },
    {
      type: 'stage.finished',
      stageId: 'QA',
      status: 'SKIPPED',
      expectedKind: 'STAGE_SKIPPED',
      expectedLabel: 'QA skipped',
    },
  ] as const)('maps $type/$status without inventing activity', (example) => {
    const base = factoryTimelineFixture().events[0]!;
    const mappedEvent = {
      ...base,
      type: example.type,
      stageId: example.stageId,
      status: example.status,
      stageName: 'untrusted',
      startedAt: null,
      finishedAt: '2026-08-08T10:00:00.300Z',
    } satisfies FactoryObservabilityEvent;
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({ job: null }),
      timeline: factoryTimelineFixture({ events: [mappedEvent] }),
    });

    expect(model.activity).toHaveLength(1);
    expect(model.activity[0]).toMatchObject({
      kind: example.expectedKind,
      label: example.expectedLabel,
    });
  });

  it('orders equal timestamps by source, event sequence, and stable id', () => {
    const timeline = factoryTimelineFixture();
    const sharedTime = '2026-08-08T09:59:59.900Z';
    const events = [
      { ...timeline.events[1]!, sequence: 2, startedAt: sharedTime },
      { ...timeline.events[0]!, sequence: 1, startedAt: sharedTime },
    ];
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture({ events }),
    });

    expect(model.activity.slice(1, 4).map((activity) => activity.id)).toEqual([
      `job:${FACTORY_JOB_ID}:started`,
      'event:1:execution.started:EXECUTION',
      'event:2:stage.started:KNOWLEDGE',
    ]);
  });

  it('is deterministic and never obtains time or randomness implicitly', () => {
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now must not be called by the factory mapper');
    });
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called by the factory mapper');
    });
    const input = {
      execution: factoryExecutionFixture(),
      timeline: factoryTimelineFixture(),
    };

    try {
      expect(createFactoryViewModel(input)).toEqual(createFactoryViewModel(input));
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });

  it('does not expose specifications, artifacts, prompts, knowledge, responses, or errors', () => {
    const execution = factoryExecutionFixture({ projectName: 'Safe public project name' });
    const timeline = factoryTimelineFixture({
      events: factoryTimelineFixture().events.map((event) => ({
        ...event,
        errorCode: 'SANITIZED_BUT_NOT_NEEDED',
      })),
    });
    const model = createFactoryViewModel({ execution, timeline });
    const serialized = JSON.stringify(model);

    expect(serialized).not.toContain('SANITIZED_BUT_NOT_NEEDED');
    expect(serialized).not.toMatch(
      /promptContent|knowledgeContent|specificationContent|artifactContent|rawResponse|stackTrace/,
    );
  });

  it('derives the propagated readiness path and Code Generator reason from persisted metadata', () => {
    const execution = factoryExecutionFixture();
    const successfulFactory = factoryResultFixture();
    const qaBlockedFactory = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'CODE_GENERATOR',
      readiness: 'PARTIALLY_READY',
      generationStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_QA_NOT_READY',
        sourceCode: null,
        reasonCode: 'SOURCE_QA_READINESS_NOT_READY',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'CODE_GENERATOR',
      },
      stages: successfulFactory.stages.map((stage) =>
        stage.stageId === 'CODE_GENERATOR'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_QA_NOT_READY',
              reasonCode: 'SOURCE_QA_READINESS_NOT_READY',
            }
          : stage,
      ),
    });
    const qaBlocked = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        readiness: 'PARTIALLY_READY',
        provenance: {
          stages: execution.provenance!.stages.map((stage) => ({
            ...stage,
            readiness: 'PARTIALLY_READY',
            readinessDecision: {
              version: '1.0.0',
              readiness: 'PARTIALLY_READY',
              decisiveFactors:
                stage.stage === 'PRODUCT_OWNER'
                  ? [
                      {
                        sourceStage: 'PRODUCT_OWNER' as const,
                        code: 'NON_BLOCKING_QUESTION_PRESENT' as const,
                      },
                    ]
                  : stage.stage === 'DEVELOPER'
                    ? [
                        {
                          sourceStage: 'PRODUCT_OWNER' as const,
                          code: 'SOURCE_PARTIALLY_READY' as const,
                        },
                      ]
                    : [
                        {
                          sourceStage: 'PRODUCT_OWNER' as const,
                          code: 'SOURCE_PARTIALLY_READY' as const,
                        },
                        {
                          sourceStage: 'DEVELOPER' as const,
                          code: 'SOURCE_PARTIALLY_READY' as const,
                        },
                      ],
            },
          })),
        },
        factoryResult: qaBlockedFactory,
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(qaBlocked.readinessTrace).toEqual({
      steps: [
        {
          agentId: 'PRODUCT_OWNER',
          agentName: 'Product Owner',
          readiness: 'PARTIALLY_READY',
          evidence: 'RECORDED',
          factors: [{ sourceStage: 'PRODUCT_OWNER', code: 'NON_BLOCKING_QUESTION_PRESENT' }],
        },
        {
          agentId: 'DEVELOPER',
          agentName: 'Developer',
          readiness: 'PARTIALLY_READY',
          evidence: 'RECORDED',
          factors: [{ sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_PARTIALLY_READY' }],
        },
        {
          agentId: 'QA',
          agentName: 'QA',
          readiness: 'PARTIALLY_READY',
          evidence: 'RECORDED',
          factors: [
            { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_PARTIALLY_READY' },
            { sourceStage: 'DEVELOPER', code: 'SOURCE_PARTIALLY_READY' },
          ],
        },
      ],
      outcome: {
        kind: 'FACTORY_BLOCKED_BEFORE_CODE_GENERATION',
        code: 'FACTORY_PIPELINE_QA_NOT_READY',
        reasonCode: 'SOURCE_QA_READINESS_NOT_READY',
      },
    });

    const sourceRejectedFactory = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'CODE_GENERATOR',
      generationStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
        sourceCode: null,
        reasonCode: 'SOURCE_CHANGE_TYPE_NOT_CREATE',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'CODE_GENERATOR',
      },
      stages: successfulFactory.stages.map((stage) =>
        stage.stageId === 'CODE_GENERATOR'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
              reasonCode: 'SOURCE_CHANGE_TYPE_NOT_CREATE',
            }
          : stage,
      ),
    });
    const sourceRejected = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: sourceRejectedFactory,
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(sourceRejected.readinessTrace.outcome).toEqual({
      kind: 'CODE_GENERATOR_SOURCE_REJECTED',
      code: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
      reasonCode: 'SOURCE_CHANGE_TYPE_NOT_CREATE',
    });

    const unknownReasonFactory = factoryResultFixture({
      status: 'FAILED',
      terminalStage: 'CODE_GENERATOR',
      generationStatus: 'FAILED',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
        sourceCode: null,
        reasonCode: 'INTERNAL_CUSTOMER_TOKEN',
        profileRuleId: null,
        diagnosticSummary: null,
        stageId: 'CODE_GENERATOR',
      },
      stages: successfulFactory.stages.map((stage) =>
        stage.stageId === 'CODE_GENERATOR'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_CODE_GENERATION_FAILED',
              reasonCode: 'INTERNAL_CUSTOMER_TOKEN',
            }
          : stage,
      ),
    });
    const unknownReason = createFactoryViewModel({
      execution: factoryExecutionFixture({
        status: 'FAILED',
        factoryResult: unknownReasonFactory,
      }),
      timeline: factoryTimelineFixture({ status: 'FAILED' }),
    });

    expect(unknownReason.readinessTrace.outcome).toBeNull();
    expect(JSON.stringify(unknownReason.readinessTrace)).not.toContain('INTERNAL_CUSTOMER_TOKEN');
    expect(JSON.stringify(sourceRejected.readinessTrace)).not.toMatch(
      /specification|prompt|response|content/iu,
    );
  });

  it('does not infer propagation from adjacent equal readiness values', () => {
    const execution = factoryExecutionFixture();
    const model = createFactoryViewModel({
      execution: factoryExecutionFixture({
        provenance: {
          stages: execution.provenance!.stages.map((stage) =>
            stage.stage === 'DEVELOPER'
              ? {
                  ...stage,
                  readiness: 'PARTIALLY_READY',
                  readinessDecision: {
                    version: '1.0.0',
                    readiness: 'PARTIALLY_READY',
                    decisiveFactors: [
                      {
                        sourceStage: 'DEVELOPER',
                        code: 'NON_BLOCKING_QUESTION_PRESENT',
                      },
                    ],
                  },
                }
              : stage.stage === 'QA'
                ? {
                    ...stage,
                    readiness: 'PARTIALLY_READY',
                    readinessDecision: null,
                  }
                : stage,
          ),
        },
      }),
      timeline: factoryTimelineFixture(),
    });

    expect(model.readinessTrace.steps[1]).toMatchObject({
      agentId: 'DEVELOPER',
      readiness: 'PARTIALLY_READY',
      evidence: 'RECORDED',
      factors: [{ sourceStage: 'DEVELOPER', code: 'NON_BLOCKING_QUESTION_PRESENT' }],
    });
    expect(model.readinessTrace.steps[2]).toMatchObject({
      agentId: 'QA',
      readiness: 'PARTIALLY_READY',
      evidence: 'LEGACY_UNKNOWN',
      factors: [],
    });
  });

  it('keeps unavailable public evidence nullable instead of manufacturing defaults', () => {
    const execution = factoryExecutionFixture({
      job: null,
      readiness: null,
      lineage: null,
      provenance: null,
      hashes: {
        executionRequestHash: null,
        workflowRequestHash: null,
        workflowHash: null,
        lineageHash: null,
        provenanceHash: null,
        executionHash: null,
      },
    });
    const timeline = factoryTimelineFixture({ summary: null, stageMetrics: [] });
    const model = createFactoryViewModel({ execution, timeline });

    expect(model.execution.jobId).toBeNull();
    expect(model.agents.every((agent) => agent.readiness === null)).toBe(true);
    expect(model.agents.every((agent) => agent.hashes.inputs.length === 0)).toBe(true);
    expect(model.agents.every((agent) => agent.hashes.output === null)).toBe(true);
    expect(model.agents.every((agent) => agent.artifacts.length === 0)).toBe(true);
    expect(model.progress).toMatchObject({ totalTokens: null, totalCostEstimate: null });
  });
});

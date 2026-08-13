import type {
  ExecutionHistoryFactoryResult,
  ExecutionHistoryTimelineV2,
  ExecutionHistoryTimelineV3,
} from '@/api/execution-history-contracts';

import type {
  FactoryExecutionSource,
  FactoryObservabilityEvent,
  FactoryTimelineSource,
} from './factory-view-model';

export const FACTORY_EXECUTION_ID = `execution-${'a'.repeat(32)}`;
export const FACTORY_WORKFLOW_ID = 'workflow-factory-001';
export const FACTORY_JOB_ID = 'job-factory-001';

const plainHash = (character: string): string => character.repeat(64);
const contentHash = (character: string): string => `sha256:${plainHash(character)}`;

export const FACTORY_HASHES = Object.freeze({
  executionRequest: plainHash('1'),
  workflowRequest: plainHash('2'),
  productOwnerSpecification: contentHash('3'),
  technicalSpecification: contentHash('4'),
  qaSpecification: contentHash('5'),
  productOwnerArtifact: plainHash('6'),
  developerArtifact: plainHash('7'),
  qaArtifact: plainHash('8'),
  common: plainHash('9'),
});

const TIMESTAMPS = Object.freeze({
  queued: '2026-08-08T09:59:59.500Z',
  jobStarted: '2026-08-08T09:59:59.900Z',
  executionStarted: '2026-08-08T10:00:00.000Z',
  knowledgeFinished: '2026-08-08T10:00:00.010Z',
  productOwnerFinished: '2026-08-08T10:00:00.100Z',
  developerFinished: '2026-08-08T10:00:00.200Z',
  qaFinished: '2026-08-08T10:00:00.250Z',
});

export function factoryResultFixture(
  overrides: Partial<ExecutionHistoryFactoryResult> = {},
): ExecutionHistoryFactoryResult {
  const stageIds = [
    'PRODUCT_OWNER',
    'DEVELOPER',
    'QA',
    'CODE_GENERATOR',
    'CODE_PROFILE_VALIDATION',
    'WORKSPACE_PLAN',
    'WORKSPACE_MATERIALIZATION',
    'SANDBOX_PREPARE',
    'SANDBOX_TYPECHECK',
    'SANDBOX_BUILD',
    'SANDBOX_TEST',
    'WORKSPACE_RELEASE',
  ] as const;
  return {
    factoryVersion: '1.0.0',
    contractVersion: '1.0.0',
    status: 'SUCCESS',
    terminalStage: 'WORKSPACE_RELEASE',
    startedAt: TIMESTAMPS.executionStarted,
    finishedAt: '2026-08-08T10:00:01.100Z',
    durationMs: 1_100,
    readiness: 'READY',
    generationStatus: 'SUCCESS',
    generatedFileCount: 4,
    generatedTotalBytes: 2_048,
    workspaceId: `workspace-${'a'.repeat(32)}`,
    workspaceFileCount: 4,
    workspaceTotalBytes: 2_048,
    workspaceReleaseStatus: 'RELEASED',
    sandboxStatus: 'SUCCESS',
    sandboxRunId: `sandbox-${'b'.repeat(32)}`,
    sandboxResourceOutcome: 'NONE',
    sandboxCleanupFailureCode: null,
    sandboxCleanupSourceCode: null,
    hashes: {
      lineageHash: plainHash('a'),
      provenanceHash: plainHash('b'),
      factoryResultHash: plainHash('c'),
    },
    failure: null,
    stages: stageIds.map((stageId, index) => ({
      stageId,
      status: 'SUCCESS',
      startedAt: `2026-08-08T10:00:0${Math.min(index, 9)}.000Z`,
      finishedAt: `2026-08-08T10:00:0${Math.min(index, 9)}.010Z`,
      durationMs: 10,
      outputHash: plainHash(String((index % 9) + 1)),
      failureCode: null,
      reasonCode: null,
      profileRuleId: null,
      diagnosticSummary: null,
      resourceOutcome: stageId.startsWith('SANDBOX_') ? 'NONE' : null,
    })),
    lineage: {
      productOwnerSpecificationHash: FACTORY_HASHES.productOwnerSpecification,
      technicalSpecificationHash: FACTORY_HASHES.technicalSpecification,
      qaSpecificationHash: FACTORY_HASHES.qaSpecification,
      executionHash: FACTORY_HASHES.common,
      workflowHash: FACTORY_HASHES.common,
      generationHash: plainHash('d'),
      bundleHash: plainHash('e'),
      bundleContentHash: plainHash('f'),
      workspacePlanHash: plainHash('a'),
      workspaceHash: plainHash('b'),
      sandboxRequestHash: plainHash('c'),
      sandboxResultHash: plainHash('d'),
      executionProfileHash: plainHash('e'),
      generationProjectionHash: plainHash('f'),
      profileValidationHash: plainHash('1'),
      factoryResultHash: plainHash('c'),
    },
    provenance: {
      codeGeneratorAgentVersion: '1.0.0',
      codeGeneratorContractVersion: '1.0.0',
      codeGeneratorAssetBundleHash: plainHash('e'),
      executionProfileId: 'NODE_WEB_PREVIEW_24_V1',
      executionProfileVersion: '1.0.0',
      executionProfileContractVersion: '1.0.0',
      executionProfileHash: plainHash('e'),
      generationProjectionHash: plainHash('f'),
      profileValidationHash: plainHash('1'),
      workspaceVersion: '1.0.0',
      workspaceContractVersion: '1.0.0',
      workspacePolicyHash: plainHash('f'),
      workspaceConfigurationHash: plainHash('a'),
      sandboxRunnerVersion: '1.0.0',
      sandboxContractVersion: '1.0.0',
      sandboxSanitizerVersion: '1.0.0',
      sandboxHelperAbiVersion: '1.0.0',
      sandboxDependencySnapshotHash: plainHash('b'),
      sandboxPolicyId: 'NODE_TYPESCRIPT_24_V1',
      sandboxPolicyVersion: '1.0.0',
      sandboxPolicyHash: plainHash('c'),
      sandboxCommandPolicyHash: plainHash('d'),
      sandboxLimitsHash: plainHash('e'),
      sandboxAdapter: 'DOCKER',
      sandboxImageDigest: contentHash('f'),
      sandboxImageId: 'sha256:factory-image-id',
      sandboxPlatform: 'linux/arm64',
      sandboxRuntimeName: 'node',
      sandboxRuntimeVersion: '24.19.0',
      toolchainVersions: { node: '24.19.0', typescript: '6.0.3' },
    },
    ...overrides,
  };
}

function event(
  sequence: number,
  values: Omit<FactoryObservabilityEvent, 'sequence' | 'executionId' | 'requestId' | 'errorCode'>,
): FactoryObservabilityEvent {
  return {
    sequence,
    executionId: FACTORY_EXECUTION_ID,
    requestId: 'request-factory-001',
    errorCode: null,
    ...values,
  };
}

export function factoryExecutionFixture(
  overrides: Partial<FactoryExecutionSource> = {},
): FactoryExecutionSource {
  return {
    executionId: FACTORY_EXECUTION_ID,
    workflowId: FACTORY_WORKFLOW_ID,
    projectName: 'Factory Control Room',
    status: 'SUCCESS',
    readiness: 'READY',
    createdAt: '2026-08-08T09:59:59.000Z',
    startedAt: TIMESTAMPS.executionStarted,
    finishedAt: TIMESTAMPS.qaFinished,
    durationMs: 250,
    requestId: 'request-factory-001',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    job: {
      jobId: FACTORY_JOB_ID,
      status: 'SUCCESS',
      queuedAt: TIMESTAMPS.queued,
      startedAt: TIMESTAMPS.jobStarted,
      finishedAt: TIMESTAMPS.qaFinished,
    },
    hashes: {
      executionRequestHash: FACTORY_HASHES.executionRequest,
      workflowRequestHash: FACTORY_HASHES.workflowRequest,
      workflowHash: FACTORY_HASHES.common,
      lineageHash: FACTORY_HASHES.common,
      provenanceHash: FACTORY_HASHES.common,
      executionHash: FACTORY_HASHES.common,
    },
    lineage: {
      outputs: {
        productOwnerSpecificationHash: FACTORY_HASHES.productOwnerSpecification,
        technicalSpecificationHash: FACTORY_HASHES.technicalSpecification,
        qaSpecificationHash: FACTORY_HASHES.qaSpecification,
      },
      handoffs: [
        {
          from: 'PRODUCT_OWNER',
          to: 'DEVELOPER',
          specification: 'PRODUCT_OWNER_SPECIFICATION',
          verified: true,
        },
        {
          from: 'DEVELOPER',
          to: 'QA',
          specification: 'TECHNICAL_SPECIFICATION',
          verified: true,
        },
        {
          from: 'PRODUCT_OWNER',
          to: 'QA',
          specification: 'PRODUCT_OWNER_SPECIFICATION',
          verified: true,
        },
      ],
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agentVersion: '1.0.1',
          outcome: 'GENERATED',
          readiness: 'READY',
          readinessDecision: {
            version: '1.0.0',
            readiness: 'READY',
            decisiveFactors: [
              { sourceStage: 'PRODUCT_OWNER', code: 'NO_LOCAL_READINESS_CONCERNS' },
            ],
          },
          hashes: {
            assetBundleHash: FACTORY_HASHES.common,
            knowledgeContextHash: FACTORY_HASHES.common,
            promptHash: FACTORY_HASHES.common,
            responseHash: FACTORY_HASHES.common,
            validationHash: FACTORY_HASHES.common,
            generationHash: FACTORY_HASHES.common,
            artifactHashes: [FACTORY_HASHES.productOwnerArtifact],
          },
        },
        {
          stage: 'DEVELOPER',
          agentVersion: '1.0.1',
          outcome: 'GENERATED',
          readiness: 'READY',
          readinessDecision: {
            version: '1.0.0',
            readiness: 'READY',
            decisiveFactors: [
              { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' },
              { sourceStage: 'DEVELOPER', code: 'NO_LOCAL_READINESS_CONCERNS' },
            ],
          },
          hashes: {
            assetBundleHash: FACTORY_HASHES.common,
            knowledgeContextHash: FACTORY_HASHES.common,
            promptHash: FACTORY_HASHES.common,
            responseHash: FACTORY_HASHES.common,
            validationHash: FACTORY_HASHES.common,
            generationHash: FACTORY_HASHES.common,
            artifactHashes: [FACTORY_HASHES.developerArtifact],
          },
        },
        {
          stage: 'QA',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
          readinessDecision: {
            version: '1.0.0',
            readiness: 'READY',
            decisiveFactors: [
              { sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' },
              { sourceStage: 'DEVELOPER', code: 'SOURCE_READY' },
              { sourceStage: 'QA', code: 'NO_LOCAL_READINESS_CONCERNS' },
            ],
          },
          hashes: {
            assetBundleHash: FACTORY_HASHES.common,
            knowledgeContextHash: FACTORY_HASHES.common,
            promptHash: FACTORY_HASHES.common,
            responseHash: FACTORY_HASHES.common,
            validationHash: FACTORY_HASHES.common,
            generationHash: FACTORY_HASHES.common,
            artifactHashes: [FACTORY_HASHES.qaArtifact],
          },
        },
      ],
    },
    factoryResult: null,
    ...overrides,
  };
}

export function factoryTimelineFixture(
  overrides: Partial<FactoryTimelineSource> = {},
): FactoryTimelineSource {
  return {
    observabilityVersion: '1.0.0',
    revision: 10,
    executionId: FACTORY_EXECUTION_ID,
    workflowId: FACTORY_WORKFLOW_ID,
    requestId: 'request-factory-001',
    status: 'SUCCESS',
    updatedAt: TIMESTAMPS.qaFinished,
    events: [
      event(1, {
        type: 'execution.started',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'RUNNING',
        startedAt: TIMESTAMPS.executionStarted,
        finishedAt: null,
        durationMs: null,
      }),
      event(2, {
        type: 'stage.started',
        stageId: 'KNOWLEDGE',
        stageName: 'Knowledge',
        status: 'RUNNING',
        startedAt: TIMESTAMPS.executionStarted,
        finishedAt: null,
        durationMs: null,
      }),
      event(3, {
        type: 'stage.finished',
        stageId: 'KNOWLEDGE',
        stageName: 'Knowledge',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.executionStarted,
        finishedAt: TIMESTAMPS.knowledgeFinished,
        durationMs: 10,
      }),
      event(4, {
        type: 'stage.started',
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'RUNNING',
        startedAt: TIMESTAMPS.knowledgeFinished,
        finishedAt: null,
        durationMs: null,
      }),
      event(5, {
        type: 'stage.finished',
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.knowledgeFinished,
        finishedAt: TIMESTAMPS.productOwnerFinished,
        durationMs: 90,
      }),
      event(6, {
        type: 'stage.started',
        stageId: 'DEVELOPER',
        stageName: 'Developer',
        status: 'RUNNING',
        startedAt: TIMESTAMPS.productOwnerFinished,
        finishedAt: null,
        durationMs: null,
      }),
      event(7, {
        type: 'stage.finished',
        stageId: 'DEVELOPER',
        stageName: 'Developer',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.productOwnerFinished,
        finishedAt: TIMESTAMPS.developerFinished,
        durationMs: 100,
      }),
      event(8, {
        type: 'stage.started',
        stageId: 'QA',
        stageName: 'QA',
        status: 'RUNNING',
        startedAt: TIMESTAMPS.developerFinished,
        finishedAt: null,
        durationMs: null,
      }),
      event(9, {
        type: 'stage.finished',
        stageId: 'QA',
        stageName: 'QA',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.developerFinished,
        finishedAt: TIMESTAMPS.qaFinished,
        durationMs: 50,
      }),
      event(10, {
        type: 'execution.finished',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.executionStarted,
        finishedAt: TIMESTAMPS.qaFinished,
        durationMs: 250,
      }),
    ],
    stages: [
      {
        stageId: 'KNOWLEDGE',
        stageName: 'Knowledge',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.executionStarted,
        finishedAt: TIMESTAMPS.knowledgeFinished,
        durationMs: 10,
        requestId: 'request-factory-001',
        executionId: FACTORY_EXECUTION_ID,
      },
      {
        stageId: 'PRODUCT_OWNER',
        stageName: 'Product Owner',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.knowledgeFinished,
        finishedAt: TIMESTAMPS.productOwnerFinished,
        durationMs: 90,
        requestId: 'request-factory-001',
        executionId: FACTORY_EXECUTION_ID,
      },
      {
        stageId: 'DEVELOPER',
        stageName: 'Developer',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.productOwnerFinished,
        finishedAt: TIMESTAMPS.developerFinished,
        durationMs: 100,
        requestId: 'request-factory-001',
        executionId: FACTORY_EXECUTION_ID,
      },
      {
        stageId: 'QA',
        stageName: 'QA',
        status: 'SUCCESS',
        startedAt: TIMESTAMPS.developerFinished,
        finishedAt: TIMESTAMPS.qaFinished,
        durationMs: 50,
        requestId: 'request-factory-001',
        executionId: FACTORY_EXECUTION_ID,
      },
    ],
    stageMetrics: [
      {
        stageId: 'PRODUCT_OWNER',
        durationMs: 90,
        promptBytes: 1200,
        completionBytes: 600,
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        providerLatencyMs: 75,
        validationDurationMs: 8,
        artifactGenerationDurationMs: 7,
      },
      {
        stageId: 'DEVELOPER',
        durationMs: 100,
        promptBytes: 1800,
        completionBytes: 900,
        inputTokens: 450,
        outputTokens: 225,
        totalTokens: 675,
        providerLatencyMs: 80,
        validationDurationMs: 10,
        artifactGenerationDurationMs: 10,
      },
      {
        stageId: 'QA',
        durationMs: 50,
        promptBytes: 1600,
        completionBytes: 800,
        inputTokens: 400,
        outputTokens: 200,
        totalTokens: 600,
        providerLatencyMs: 40,
        validationDurationMs: 5,
        artifactGenerationDurationMs: 5,
      },
    ],
    summary: {
      executionId: FACTORY_EXECUTION_ID,
      workflowStatus: 'SUCCESS',
      readinessFinal: 'READY',
      totalDurationMs: 250,
      totalTokens: 1725,
      totalCostEstimate: { amount: 0.021, currency: 'USD', rateCardVersion: '1.0.0' },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
      hashes: {
        executionRequestHash: FACTORY_HASHES.executionRequest,
        workflowRequestHash: FACTORY_HASHES.workflowRequest,
        workflowHash: FACTORY_HASHES.common,
        lineageHash: FACTORY_HASHES.common,
        provenanceHash: FACTORY_HASHES.common,
        executionHash: FACTORY_HASHES.common,
      },
    },
    ...overrides,
  };
}

export function factoryTimelineV2Fixture(
  overrides: Partial<ExecutionHistoryTimelineV2> = {},
): ExecutionHistoryTimelineV2 {
  const legacy = factoryTimelineFixture();
  const technical = [
    ['CODE_GENERATOR', 'Code Generator'],
    ['WORKSPACE', 'Controlled Workspace'],
    ['SANDBOX_PREPARE', 'Prepare'],
    ['SANDBOX_TYPECHECK', 'Typecheck'],
    ['SANDBOX_BUILD', 'Build'],
    ['SANDBOX_TEST', 'Test'],
  ] as const;
  const technicalStages = technical.map(([stageId, stageName], index) => ({
    stageId,
    stageName,
    status: 'SUCCESS' as const,
    startedAt: `2026-08-08T10:00:00.${300 + index * 100}Z`,
    finishedAt: `2026-08-08T10:00:00.${350 + index * 100}Z`,
    durationMs: 50,
    requestId: 'request-factory-001',
    executionId: FACTORY_EXECUTION_ID,
  }));
  const stages = [...legacy.stages, ...technicalStages] as ExecutionHistoryTimelineV2['stages'];

  return {
    ...legacy,
    observabilityVersion: '2.0.0',
    revision: 22,
    updatedAt: '2026-08-08T10:00:00.850Z',
    events: legacy.events,
    stages,
    summary: {
      ...legacy.summary!,
      executedStages: stages.map((stage) => stage.stageId),
      skippedStages: [],
      factoryStatus: 'SUCCESS',
      factoryResultHash: plainHash('c'),
    },
    ...overrides,
  };
}

export function factoryTimelineV3Fixture(
  overrides: Partial<ExecutionHistoryTimelineV3> = {},
): ExecutionHistoryTimelineV3 {
  const v2 = factoryTimelineV2Fixture();
  return {
    ...v2,
    observabilityVersion: '3.0.0',
    stageMetrics: [
      ...v2.stageMetrics,
      {
        ...v2.stageMetrics[0]!,
        stageId: 'CODE_GENERATOR',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    ],
    summary:
      v2.summary === null ? null : { ...v2.summary, totalTokens: v2.summary.totalTokens + 150 },
    ...overrides,
  };
}

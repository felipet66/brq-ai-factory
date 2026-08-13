import { describe, expect, it, vi } from 'vitest';

import { historyFactoryResult } from '@/test/history-fixtures';

import { getExecution, getExecutionTimeline, listExecutions } from './execution-history-client';

const EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const OTHER_EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const HASH = '1'.repeat(64);
const KNOWLEDGE_HASH = `sha256:${'2'.repeat(64)}`;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function metadata(executionId?: string) {
  return {
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    apiVersion: '1.0.0',
    ...(executionId === undefined ? {} : { executionId }),
  };
}

function successEnvelope(data: unknown, executionId?: string) {
  return { success: true, data, metadata: metadata(executionId), errors: [] };
}

function historyItem(overrides: Record<string, unknown> = {}) {
  return {
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    projectName: 'Customer Portal',
    status: 'SUCCESS',
    readiness: 'READY',
    startedAt: '2026-08-07T10:00:00.000Z',
    finishedAt: '2026-08-07T10:00:00.250Z',
    durationMs: 250,
    ...overrides,
  };
}

function detailData(overrides: Record<string, unknown> = {}) {
  return {
    ...historyItem(),
    createdAt: '2026-08-07T09:59:59.999Z',
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    metadata: { engineVersion: '1.0.0', contractVersion: '1.0.0', attempt: 1 },
    job: {
      jobId: `job-${'b'.repeat(32)}`,
      status: 'SUCCESS',
      queuedAt: '2026-08-07T09:59:59.000Z',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.250Z',
    },
    hashes: {
      executionRequestHash: HASH,
      workflowRequestHash: HASH,
      workflowHash: HASH,
      lineageHash: HASH,
      provenanceHash: HASH,
      executionHash: HASH,
    },
    lineage: {
      outputs: {
        productOwnerSpecificationHash: KNOWLEDGE_HASH,
        technicalSpecificationHash: KNOWLEDGE_HASH,
        qaSpecificationHash: KNOWLEDGE_HASH,
      },
      handoffs: [
        {
          from: 'PRODUCT_OWNER',
          to: 'DEVELOPER',
          specification: 'PRODUCT_OWNER_SPECIFICATION',
          calculatedHash: KNOWLEDGE_HASH,
          declaredHash: KNOWLEDGE_HASH,
          verified: true,
        },
      ],
      privateValue: 'must not cross the presentation boundary',
    },
    provenance: {
      stages: [
        {
          stage: 'PRODUCT_OWNER',
          agent: 'PRODUCT_OWNER',
          executionId: EXECUTION_ID,
          agentExecutionId: 'po-001',
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
            assetBundleHash: HASH,
            knowledgeContextHash: KNOWLEDGE_HASH,
            promptHash: HASH,
            responseHash: HASH,
            validationHash: HASH,
            generationHash: HASH,
            artifactHashes: [HASH],
          },
          privateValue: 'must not cross the presentation boundary',
        },
      ],
    },
    factoryResult: null,
    rawResponse: 'must not cross the presentation boundary',
    ...overrides,
  };
}

function timelineData(overrides: Record<string, unknown> = {}) {
  return {
    observabilityVersion: '1.0.0',
    revision: 9,
    executionId: EXECUTION_ID,
    workflowId: 'workflow-001',
    requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    status: 'SUCCESS',
    updatedAt: '2026-08-07T10:00:00.250Z',
    events: [
      {
        sequence: 1,
        type: 'execution.started',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'RUNNING',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
        requestId: 'request-001',
        executionId: EXECUTION_ID,
        errorCode: null,
        privateValue: 'must not cross the presentation boundary',
      },
      {
        sequence: 2,
        type: 'execution.finished',
        stageId: 'EXECUTION',
        stageName: 'Execution',
        status: 'SUCCESS',
        startedAt: '2026-08-07T10:00:00.000Z',
        finishedAt: '2026-08-07T10:00:00.250Z',
        durationMs: 250,
        requestId: 'request-001',
        executionId: EXECUTION_ID,
        errorCode: null,
      },
    ],
    stages: [
      ['KNOWLEDGE', 'Knowledge'],
      ['PRODUCT_OWNER', 'Product Owner'],
      ['DEVELOPER', 'Developer'],
      ['QA', 'QA'],
    ].map(([stageId, stageName]) => ({
      stageId,
      stageName,
      status: 'SUCCESS',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.010Z',
      durationMs: 10,
      requestId: 'request-001',
      executionId: EXECUTION_ID,
    })),
    stageMetrics: ['PRODUCT_OWNER', 'DEVELOPER', 'QA'].map((stageId) => ({
      stageId,
      durationMs: 10,
      promptBytes: 100,
      completionBytes: 50,
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
      providerLatencyMs: 8,
      validationDurationMs: 1,
      artifactGenerationDurationMs: 1,
    })),
    summary: {
      executionId: EXECUTION_ID,
      workflowStatus: 'SUCCESS',
      readinessFinal: 'READY',
      totalDurationMs: 250,
      totalTokens: 90,
      totalCostEstimate: { amount: 0.001, currency: 'USD', rateCardVersion: '1.0.0' },
      executedStages: ['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA'],
      skippedStages: [],
      hashes: {
        executionRequestHash: HASH,
        workflowRequestHash: HASH,
        workflowHash: HASH,
        lineageHash: HASH,
        provenanceHash: HASH,
        executionHash: HASH,
      },
    },
    ...overrides,
  };
}

function timelineV2Data(overrides: Record<string, unknown> = {}) {
  const legacy = timelineData();
  const technicalStages = [
    ['CODE_GENERATOR', 'Code Generator'],
    ['WORKSPACE', 'Controlled Workspace'],
    ['SANDBOX_PREPARE', 'Prepare'],
    ['SANDBOX_TYPECHECK', 'Typecheck'],
    ['SANDBOX_BUILD', 'Build'],
    ['SANDBOX_TEST', 'Test'],
  ].map(([stageId, stageName]) => ({
    stageId,
    stageName,
    status: 'SUCCESS',
    startedAt: '2026-08-07T10:00:00.250Z',
    finishedAt: '2026-08-07T10:00:00.300Z',
    durationMs: 50,
    requestId: 'request-001',
    executionId: EXECUTION_ID,
  }));
  return {
    ...legacy,
    observabilityVersion: '2.0.0',
    revision: 15,
    updatedAt: '2026-08-07T10:00:00.300Z',
    stages: [...(legacy.stages as unknown[]), ...technicalStages],
    summary: {
      ...(legacy.summary as Record<string, unknown>),
      executedStages: [
        'KNOWLEDGE',
        'PRODUCT_OWNER',
        'DEVELOPER',
        'QA',
        'CODE_GENERATOR',
        'WORKSPACE',
        'SANDBOX_PREPARE',
        'SANDBOX_TYPECHECK',
        'SANDBOX_BUILD',
        'SANDBOX_TEST',
      ],
      skippedStages: [],
      factoryStatus: 'SUCCESS',
      factoryResultHash: '3'.repeat(64),
    },
    ...overrides,
  };
}

function timelineV3Data(overrides: Record<string, unknown> = {}) {
  const v2 = timelineV2Data();
  const v2Summary = v2.summary as Record<string, unknown>;
  const legacyTotalTokens =
    typeof v2Summary.totalTokens === 'number'
      ? v2Summary.totalTokens
      : (v2.stageMetrics as { readonly totalTokens?: number | null }[]).reduce(
          (total, metrics) => total + (metrics.totalTokens ?? 0),
          0,
        );
  return {
    ...v2,
    observabilityVersion: '3.0.0',
    stageMetrics: [
      ...(v2.stageMetrics as Record<string, unknown>[]),
      {
        ...(v2.stageMetrics as Record<string, unknown>[])[0],
        stageId: 'CODE_GENERATOR',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      },
    ],
    summary: {
      ...v2Summary,
      totalTokens: legacyTotalTokens + 150,
    },
    ...overrides,
  };
}

describe('execution history HTTP client', () => {
  it('builds the canonical list query and projects immutable list items', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope({
          items: [historyItem({ privateValue: 'not projected' })],
          nextCursor: 'cursor-002',
        }),
      ),
    );

    const result = await listExecutions(
      {
        status: 'SUCCESS',
        readiness: ' READY ',
        createdAfter: '2026-08-01T00:00:00.000Z',
        createdBefore: '2026-08-31T23:59:59.999Z',
        limit: 20,
        cursor: ' cursor-001 ',
      },
      { fetchImplementation },
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      '/api/executions?status=SUCCESS&readiness=READY&createdAfter=2026-08-01T00%3A00%3A00.000Z&createdBefore=2026-08-31T23%3A59%3A59.999Z&limit=20&cursor=cursor-001',
      {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      },
    );
    expect(result).toEqual({ items: [historyItem()], nextCursor: 'cursor-002' });
    expect(result.items[0]).not.toHaveProperty('privateValue');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
  });

  it('rejects invalid filters before HTTP is called', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();

    await expect(
      listExecutions(
        {
          createdAfter: '2026-09-01T00:00:00.000Z',
          createdBefore: '2026-08-01T00:00:00.000Z',
        },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_FILTERS' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('validates and minimizes persisted execution detail', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData(), EXECUTION_ID)),
    );

    const detail = await getExecution(EXECUTION_ID, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(detail).not.toHaveProperty('rawResponse');
    expect(detail.lineage).not.toHaveProperty('privateValue');
    expect(detail.provenance?.stages[0]).not.toHaveProperty('privateValue');
    expect(detail.provenance?.stages[0]?.readinessDecision).toEqual({
      version: '1.0.0',
      readiness: 'READY',
      decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'NO_LOCAL_READINESS_CONCERNS' }],
    });
    expect(detail.lineage?.handoffs[0]).toEqual({
      from: 'PRODUCT_OWNER',
      to: 'DEVELOPER',
      specification: 'PRODUCT_OWNER_SPECIFICATION',
      verified: true,
    });
    expect(detail.job).toEqual({
      jobId: `job-${'b'.repeat(32)}`,
      status: 'SUCCESS',
      queuedAt: '2026-08-07T09:59:59.000Z',
      startedAt: '2026-08-07T10:00:00.000Z',
      finishedAt: '2026-08-07T10:00:00.250Z',
    });
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.job)).toBe(true);
    expect(Object.isFrozen(detail.provenance?.stages[0]?.hashes.artifactHashes)).toBe(true);
    expect(Object.isFrozen(detail.provenance?.stages[0]?.readinessDecision?.decisiveFactors)).toBe(
      true,
    );
  });

  it('accepts legacy null evidence and rejects contradictory readiness evidence', async () => {
    const source = detailData();
    const productOwner = source.provenance.stages[0]!;
    const legacy = {
      ...source,
      provenance: {
        ...source.provenance,
        stages: [{ ...productOwner, readinessDecision: null }],
      },
    };
    const legacyFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(legacy, EXECUTION_ID)),
    );

    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: legacyFetch }),
    ).resolves.toMatchObject({
      provenance: { stages: [{ outcome: 'GENERATED', readinessDecision: null }] },
    });

    const stageMismatch = {
      ...source,
      provenance: {
        ...source.provenance,
        stages: [
          {
            ...productOwner,
            readinessDecision: {
              version: '1.0.0',
              readiness: 'PARTIALLY_READY',
              decisiveFactors: [
                { sourceStage: 'PRODUCT_OWNER', code: 'NON_BLOCKING_QUESTION_PRESENT' },
              ],
            },
          },
        ],
      },
    };
    const stageMismatchFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(stageMismatch, EXECUTION_ID)),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: stageMismatchFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const sourceMismatch = {
      ...source,
      provenance: {
        ...source.provenance,
        stages: [
          productOwner,
          {
            ...productOwner,
            stage: 'DEVELOPER',
            agentExecutionId: 'developer-001',
            readiness: 'PARTIALLY_READY',
            readinessDecision: {
              version: '1.0.0',
              readiness: 'PARTIALLY_READY',
              decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_PARTIALLY_READY' }],
            },
          },
        ],
      },
    };
    const sourceMismatchFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(sourceMismatch, EXECUTION_ID)),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: sourceMismatchFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const invalidGeneratedReadinessFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          {
            ...source,
            provenance: {
              ...source.provenance,
              stages: [
                { ...productOwner, readiness: 'MODEL_INVENTED_VALUE', readinessDecision: null },
              ],
            },
          },
          EXECUTION_ID,
        ),
      ),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: invalidGeneratedReadinessFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const rejectedWithReadinessFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          {
            ...source,
            provenance: {
              ...source.provenance,
              stages: [
                {
                  ...productOwner,
                  outcome: 'VALIDATION_REJECTED',
                  readiness: 'READY',
                  readinessDecision: null,
                },
              ],
            },
          },
          EXECUTION_ID,
        ),
      ),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: rejectedWithReadinessFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const duplicateStagesFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          {
            ...source,
            provenance: { ...source.provenance, stages: [productOwner, productOwner] },
          },
          EXECUTION_ID,
        ),
      ),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: duplicateStagesFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const developer = {
      ...productOwner,
      stage: 'DEVELOPER',
      agentExecutionId: 'developer-001',
      readinessDecision: {
        version: '1.0.0',
        readiness: 'READY',
        decisiveFactors: [{ sourceStage: 'PRODUCT_OWNER', code: 'SOURCE_READY' }],
      },
    };
    const reorderedStagesFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          {
            ...source,
            provenance: { ...source.provenance, stages: [developer, productOwner] },
          },
          EXECUTION_ID,
        ),
      ),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: reorderedStagesFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('projects immutable safe Factory metadata and rejects non-canonical sensitive fields', async () => {
    const factoryResult = historyFactoryResult();
    const validFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          detailData({ factoryResult, generatedSource: 'not projected' }),
          EXECUTION_ID,
        ),
      ),
    );

    const detail = await getExecution(EXECUTION_ID, { fetchImplementation: validFetch });

    expect(detail.factoryResult).toMatchObject({
      status: 'SUCCESS',
      workspaceReleaseStatus: 'RELEASED',
      sandboxStatus: 'SUCCESS',
      hashes: { factoryResultHash: '3'.repeat(64) },
    });
    expect(detail).not.toHaveProperty('generatedSource');
    expect(Object.isFrozen(detail.factoryResult)).toBe(true);
    expect(Object.isFrozen(detail.factoryResult?.stages)).toBe(true);
    expect(Object.isFrozen(detail.factoryResult?.provenance.toolchainVersions)).toBe(true);
    expect(JSON.stringify(detail.factoryResult)).not.toMatch(
      /stdout|stderr|sourceCodeText|filesystem/,
    );

    const invalidFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          detailData({
            factoryResult: { ...factoryResult, stdout: 'private command output' },
          }),
          EXECUTION_ID,
        ),
      ),
    );
    await expect(
      getExecution(EXECUTION_ID, { fetchImplementation: invalidFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('carries nullable safe reason codes and profile hashes through the browser contract', async () => {
    const successful = historyFactoryResult();
    const factoryResult = historyFactoryResult({
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
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData({ status: 'FAILED', factoryResult }), EXECUTION_ID)),
    );

    const detail = await getExecution(EXECUTION_ID, { fetchImplementation });

    expect(detail.factoryResult?.failure).toEqual({
      kind: 'FACTORY_PIPELINE',
      code: 'SANDBOX_STEP_FAILED',
      sourceCode: null,
      reasonCode: 'INLINE_ACTIVE_CONTENT',
      profileRuleId: null,
      diagnosticSummary: null,
      stageId: 'SANDBOX_PREPARE',
    });
    expect(detail.factoryResult?.lineage).toMatchObject({
      executionProfileHash: HASH,
      generationProjectionHash: HASH,
      profileValidationHash: HASH,
    });
    expect(JSON.stringify(detail.factoryResult)).not.toContain('EXIT_1');
  });

  it('preserves only bounded TypeScript diagnostic metadata in the browser contract', async () => {
    const successful = historyFactoryResult();
    const diagnosticSummary = {
      diagnosticCount: 3,
      diagnosticCodes: [2307, 2322],
      truncated: false,
    } as const;
    const factoryResult = historyFactoryResult({
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
    const validFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData({ status: 'FAILED', factoryResult }), EXECUTION_ID)),
    );

    const detail = await getExecution(EXECUTION_ID, { fetchImplementation: validFetch });
    expect(detail.factoryResult?.failure?.diagnosticSummary).toEqual(diagnosticSummary);
    expect(
      detail.factoryResult?.stages.find((stage) => stage.stageId === 'SANDBOX_TYPECHECK')
        ?.diagnosticSummary,
    ).toEqual(diagnosticSummary);

    const unsafeFactoryResult = {
      ...factoryResult,
      failure: {
        ...factoryResult.failure!,
        diagnosticSummary: {
          ...diagnosticSummary,
          path: '/private/workspace/src/index.ts',
          message: 'private source',
        },
      },
      stages: factoryResult.stages.map((stage) =>
        stage.stageId === 'SANDBOX_TYPECHECK'
          ? {
              ...stage,
              diagnosticSummary: {
                ...diagnosticSummary,
                path: '/private/workspace/src/index.ts',
              },
            }
          : stage,
      ),
    };
    const unsafeFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          detailData({ status: 'FAILED', factoryResult: unsafeFactoryResult }),
          EXECUTION_ID,
        ),
      ),
    );
    const sanitized = await getExecution(EXECUTION_ID, { fetchImplementation: unsafeFetch });
    expect(sanitized.factoryResult?.failure?.diagnosticSummary).toBeNull();
    expect(
      sanitized.factoryResult?.stages.find((stage) => stage.stageId === 'SANDBOX_TYPECHECK')
        ?.diagnosticSummary,
    ).toBeNull();
    expect(JSON.stringify(sanitized)).not.toMatch(/private workspace|private source|index\.ts/iu);
  });

  it('preserves only allowlisted Factory Profile rule identifiers in the browser contract', async () => {
    const successful = historyFactoryResult();
    const factoryResult = historyFactoryResult({
      status: 'FAILED',
      terminalStage: 'CODE_PROFILE_VALIDATION',
      failure: {
        kind: 'FACTORY_PIPELINE',
        code: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
        sourceCode: null,
        reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
        profileRuleId: 'content.javascript.relative-references',
        diagnosticSummary: null,
        stageId: 'CODE_PROFILE_VALIDATION',
      },
      stages: successful.stages.map((stage) =>
        stage.stageId === 'CODE_PROFILE_VALIDATION'
          ? {
              ...stage,
              status: 'FAILED',
              failureCode: 'FACTORY_PIPELINE_CODE_PROFILE_VALIDATION_FAILED',
              reasonCode: 'EXTERNAL_OR_UNSAFE_REFERENCE',
              profileRuleId: 'content.javascript.relative-references',
            }
          : stage,
      ),
    });
    const allowlistedFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData({ status: 'FAILED', factoryResult }), EXECUTION_ID)),
    );

    const allowlisted = await getExecution(EXECUTION_ID, {
      fetchImplementation: allowlistedFetch,
    });

    expect(allowlisted.factoryResult?.failure?.profileRuleId).toBe(
      'content.javascript.relative-references',
    );
    expect(
      allowlisted.factoryResult?.stages.find((stage) => stage.stageId === 'CODE_PROFILE_VALIDATION')
        ?.profileRuleId,
    ).toBe('content.javascript.relative-references');

    const unknownFactoryResult = {
      ...factoryResult,
      failure: { ...factoryResult.failure!, profileRuleId: 'internal.customer.rule' },
      stages: factoryResult.stages.map((stage) =>
        stage.stageId === 'CODE_PROFILE_VALIDATION'
          ? { ...stage, profileRuleId: 'internal.customer.rule' }
          : stage,
      ),
    };
    const unknownFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope(
          detailData({ status: 'FAILED', factoryResult: unknownFactoryResult }),
          EXECUTION_ID,
        ),
      ),
    );

    const sanitized = await getExecution(EXECUTION_ID, { fetchImplementation: unknownFetch });

    expect(sanitized.factoryResult?.failure?.profileRuleId).toBeNull();
    expect(
      sanitized.factoryResult?.stages.find((stage) => stage.stageId === 'CODE_PROFILE_VALIDATION')
        ?.profileRuleId,
    ).toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain('internal.customer.rule');
  });

  it('rejects an uncorrelated detail and an invalid execution identifier', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(detailData({ executionId: OTHER_EXECUTION_ID }))),
    );

    await expect(getExecution(EXECUTION_ID, { fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(getExecution('../secret', { fetchImplementation })).rejects.toMatchObject({
      code: 'INVALID_EXECUTION_ID',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('loads the persisted timeline and preserves sanitized events and correlation metadata', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(timelineData(), EXECUTION_ID)),
    );

    const timeline = await getExecutionTimeline(EXECUTION_ID, { fetchImplementation });

    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/executions/${EXECUTION_ID}/timeline`,
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    );
    expect(timeline).toMatchObject({
      observabilityVersion: '1.0.0',
      executionId: EXECUTION_ID,
      workflowId: 'workflow-001',
      requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
    });
    expect(timeline.events).toHaveLength(2);
    expect(timeline.events[0]).not.toHaveProperty('privateValue');
    expect(timeline.stages).toHaveLength(4);
    expect(timeline.stageMetrics).toHaveLength(3);
    expect(timeline.summary?.totalTokens).toBe(90);
    expect(timeline.summary?.readinessFinal).toBe('READY');
    expect(timeline.summary?.hashes.executionHash).toBe(HASH);
    expect(Object.isFrozen(timeline.events)).toBe(true);
    expect(Object.isFrozen(timeline.events[0])).toBe(true);
    expect(Object.isFrozen(timeline.stages)).toBe(true);
  });

  it('accepts Observability v2 while retaining the v1 browser contract', async () => {
    const v2Fetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(timelineV2Data(), EXECUTION_ID)),
    );

    const timeline = await getExecutionTimeline(EXECUTION_ID, { fetchImplementation: v2Fetch });

    expect(timeline.observabilityVersion).toBe('2.0.0');
    expect(timeline.stages).toHaveLength(10);
    expect(timeline.stages.map((stage) => stage.stageId).slice(4)).toEqual([
      'CODE_GENERATOR',
      'WORKSPACE',
      'SANDBOX_PREPARE',
      'SANDBOX_TYPECHECK',
      'SANDBOX_BUILD',
      'SANDBOX_TEST',
    ]);
    expect(timeline.summary).toMatchObject({
      factoryStatus: 'SUCCESS',
      factoryResultHash: '3'.repeat(64),
    });
    expect(Object.isFrozen(timeline.stages)).toBe(true);

    const invalidOrderFetch = vi.fn<FetchImplementation>(async () => {
      const invalid = timelineV2Data();
      const stages = [...(invalid.stages as unknown[])];
      [stages[4], stages[5]] = [stages[5], stages[4]];
      return jsonResponse(successEnvelope({ ...invalid, stages }, EXECUTION_ID));
    });
    await expect(
      getExecutionTimeline(EXECUTION_ID, { fetchImplementation: invalidOrderFetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('accepts Observability v3 with Code Generator metrics and preserves v2 cardinality', async () => {
    const v3Fetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope(timelineV3Data(), EXECUTION_ID)),
    );

    const timeline = await getExecutionTimeline(EXECUTION_ID, { fetchImplementation: v3Fetch });

    expect(timeline.observabilityVersion).toBe('3.0.0');
    expect(timeline.stageMetrics).toHaveLength(4);
    expect(timeline.stageMetrics[3]).toMatchObject({
      stageId: 'CODE_GENERATOR',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });

    const mislabeledV2Fetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        successEnvelope({ ...timelineV3Data(), observabilityVersion: '2.0.0' }, EXECUTION_ID),
      ),
    );
    await expect(
      getExecutionTimeline(EXECUTION_ID, { fetchImplementation: mislabeledV2Fetch }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('surfaces a sanitized API error with request correlation', async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: metadata(),
          errors: [{ code: 'EXECUTION_NOT_FOUND', message: 'Execution not found.' }],
        },
        404,
      ),
    );

    await expect(getExecution(EXECUTION_ID, { fetchImplementation })).rejects.toEqual(
      expect.objectContaining({
        name: 'ExecutionHistoryClientError',
        code: 'API_ERROR',
        status: 404,
        requestId: 'request-123e4567-e89b-12d3-a456-426614174000',
        message: 'Execution not found.',
      }),
    );
  });

  it('rejects malformed and non-JSON responses without leaking their body', async () => {
    const malformedFetch = vi.fn<FetchImplementation>(async () =>
      jsonResponse(successEnvelope({ items: 'secret malformed payload', nextCursor: null })),
    );
    const textFetch = vi.fn<FetchImplementation>(
      async () =>
        new Response('secret internal response', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    );

    await expect(listExecutions({}, { fetchImplementation: malformedFetch })).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
    await expect(listExecutions({}, { fetchImplementation: textFetch })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'The execution history response is invalid.',
    });
  });

  it('maps network and cancellation failures separately', async () => {
    const networkFetch = vi.fn<FetchImplementation>(async () => {
      throw new Error('secret network internals');
    });
    const controller = new AbortController();
    controller.abort();
    const abortedFetch = vi.fn<FetchImplementation>(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(listExecutions({}, { fetchImplementation: networkFetch })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Execution history is unavailable.',
    });
    await expect(
      listExecutions({}, { fetchImplementation: abortedFetch, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'REQUEST_ABORTED' });
  });
});

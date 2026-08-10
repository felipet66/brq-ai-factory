import { z } from 'zod';

import type {
  ExecutionHistoryDetail,
  ExecutionHistoryFilters,
  ExecutionHistoryItem,
  ExecutionHistoryPage,
  ExecutionHistoryTimeline,
} from './execution-history-contracts';

const EXECUTIONS_ENDPOINT = '/api/executions';
const EXECUTION_ID_PATTERN = /^execution-[a-f0-9]{32}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KNOWLEDGE_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

const executionIdSchema = z.string().regex(EXECUTION_ID_PATTERN);
const jobIdSchema = z.string().regex(/^job-[a-f0-9]{32}$/);
const executionStatusSchema = z.enum(['CREATED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']);
const jobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']);
const terminalStatusSchema = z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']);
const stageStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
]);
const legacyStageIdSchema = z.enum(['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const factoryTimelineStageIdSchema = z.enum([
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
]);
const factoryPipelineStageIdSchema = z.enum([
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'CODE_GENERATOR',
  'WORKSPACE_PLAN',
  'WORKSPACE_MATERIALIZATION',
  'SANDBOX_PREPARE',
  'SANDBOX_TYPECHECK',
  'SANDBOX_BUILD',
  'SANDBOX_TEST',
  'WORKSPACE_RELEASE',
]);
const agentStageIdSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const workflowStageSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const observabilityStageIdSchema = z.enum([
  'EXECUTION',
  ...factoryTimelineStageIdSchema.options,
  'WORKFLOW',
  'FACTORY',
]);
const observabilityEventTypeSchema = z.enum([
  'execution.started',
  'execution.finished',
  'execution.failed',
  'stage.started',
  'stage.finished',
  'stage.failed',
]);
const nullableDateTimeSchema = z.string().datetime({ offset: true }).nullable();
const nullableMetricSchema = z.number().int().nonnegative().nullable();
const nullableHashSchema = z.string().regex(HASH_PATTERN).nullable();
const nullableKnowledgeHashSchema = z.string().regex(KNOWLEDGE_HASH_PATTERN).nullable();
const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

const historyFiltersSchema = z
  .object({
    status: executionStatusSchema.optional(),
    readiness: z.string().trim().min(1).max(64).optional(),
    createdAfter: z.string().datetime({ offset: true }).optional(),
    createdBefore: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().trim().min(1).max(128).optional(),
  })
  .strict()
  .refine(
    ({ createdAfter, createdBefore }) =>
      createdAfter === undefined ||
      createdBefore === undefined ||
      Date.parse(createdAfter) <= Date.parse(createdBefore),
    { message: 'The history date range is invalid.' },
  );

const rawHistoryItemSchema = z
  .object({
    executionId: executionIdSchema.nullable(),
    workflowId: z.string().min(1).max(128),
    projectName: z.string().min(1).max(500),
    status: executionStatusSchema,
    readiness: z.string().min(1).max(64).nullable(),
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: nullableMetricSchema,
  })
  .passthrough();

const rawHistoryPageSchema = z
  .object({
    items: z.array(rawHistoryItemSchema).max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();

const rawHashesSchema = z
  .object({
    executionRequestHash: nullableHashSchema,
    workflowRequestHash: nullableHashSchema,
    workflowHash: nullableHashSchema,
    lineageHash: nullableHashSchema,
    provenanceHash: nullableHashSchema,
    executionHash: nullableHashSchema,
  })
  .strict();

const rawLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: nullableKnowledgeHashSchema,
        technicalSpecificationHash: nullableKnowledgeHashSchema,
        qaSpecificationHash: nullableKnowledgeHashSchema,
      })
      .strict(),
    handoffs: z
      .array(
        z
          .object({
            from: z.enum(['PRODUCT_OWNER', 'DEVELOPER']),
            to: z.enum(['DEVELOPER', 'QA']),
            specification: z.enum(['PRODUCT_OWNER_SPECIFICATION', 'TECHNICAL_SPECIFICATION']),
            verified: z.literal(true),
          })
          .passthrough(),
      )
      .max(3),
  })
  .passthrough();

const rawProvenanceSchema = z
  .object({
    stages: z
      .array(
        z
          .object({
            stage: workflowStageSchema,
            agentVersion: z.string().min(1).max(128),
            outcome: z.enum(['GENERATED', 'VALIDATION_REJECTED']),
            readiness: z.string().min(1).max(64).nullable(),
            hashes: z
              .object({
                assetBundleHash: z.string().regex(HASH_PATTERN),
                knowledgeContextHash: z.string().regex(KNOWLEDGE_HASH_PATTERN),
                promptHash: z.string().regex(HASH_PATTERN),
                responseHash: z.string().regex(HASH_PATTERN),
                validationHash: z.string().regex(HASH_PATTERN),
                generationHash: nullableHashSchema,
                artifactHashes: z.array(z.string().regex(HASH_PATTERN)).max(100),
              })
              .strict(),
          })
          .passthrough(),
      )
      .max(3),
  })
  .passthrough();

const rawFactoryStageSchema = z
  .object({
    stageId: factoryPipelineStageIdSchema,
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED']),
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: nullableMetricSchema,
    outputHash: nullableHashSchema,
    failureCode: z.string().min(1).max(128).nullable(),
    resourceOutcome: z
      .enum(['NONE', 'OOM', 'PID_LIMIT', 'DISK_LIMIT', 'OUTPUT_LIMIT', 'UNKNOWN'])
      .nullable(),
  })
  .strict();

const rawFactoryResultSchema = z
  .object({
    factoryVersion: semanticVersionSchema,
    contractVersion: semanticVersionSchema,
    status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    terminalStage: z.union([
      factoryPipelineStageIdSchema,
      z.literal('EXECUTION'),
      z.literal('SANDBOX'),
    ]),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
    durationMs: z.number().int().nonnegative(),
    readiness: z.string().min(1).max(64).nullable(),
    generationStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED', 'SKIPPED']),
    generatedFileCount: z.number().int().positive().nullable(),
    generatedTotalBytes: z.number().int().positive().nullable(),
    workspaceId: z
      .string()
      .regex(/^workspace-[a-f0-9]{32}$/)
      .nullable(),
    workspaceFileCount: z.number().int().positive().nullable(),
    workspaceTotalBytes: z.number().int().nonnegative().nullable(),
    workspaceReleaseStatus: z.enum(['RELEASED', 'FAILED', 'NOT_REQUIRED']),
    sandboxStatus: z.enum(['SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'SKIPPED']),
    sandboxRunId: z
      .string()
      .regex(/^sandbox-[a-f0-9]{32}$/)
      .nullable(),
    sandboxResourceOutcome: z.enum([
      'NONE',
      'OOM',
      'PID_LIMIT',
      'DISK_LIMIT',
      'OUTPUT_LIMIT',
      'UNKNOWN',
    ]),
    hashes: z
      .object({
        lineageHash: z.string().regex(HASH_PATTERN),
        provenanceHash: z.string().regex(HASH_PATTERN),
        factoryResultHash: z.string().regex(HASH_PATTERN),
      })
      .strict(),
    failure: z
      .object({
        kind: z.literal('FACTORY_PIPELINE'),
        code: z.string().min(1).max(128),
        sourceCode: z.string().min(1).max(128).nullable(),
        stageId: z.union([
          factoryPipelineStageIdSchema,
          z.literal('EXECUTION'),
          z.literal('SANDBOX'),
        ]),
      })
      .strict()
      .nullable(),
    stages: z.array(rawFactoryStageSchema).length(11),
    lineage: z
      .object({
        productOwnerSpecificationHash: nullableKnowledgeHashSchema,
        technicalSpecificationHash: nullableKnowledgeHashSchema,
        qaSpecificationHash: nullableKnowledgeHashSchema,
        executionHash: z.string().regex(HASH_PATTERN),
        workflowHash: nullableHashSchema,
        generationHash: nullableHashSchema,
        bundleHash: nullableHashSchema,
        bundleContentHash: nullableHashSchema,
        workspacePlanHash: nullableHashSchema,
        workspaceHash: nullableHashSchema,
        sandboxRequestHash: nullableHashSchema,
        sandboxResultHash: nullableHashSchema,
        factoryResultHash: z.string().regex(HASH_PATTERN),
      })
      .strict(),
    provenance: z
      .object({
        codeGeneratorAgentVersion: semanticVersionSchema,
        codeGeneratorContractVersion: semanticVersionSchema.nullable(),
        codeGeneratorAssetBundleHash: nullableHashSchema,
        workspaceVersion: semanticVersionSchema.nullable(),
        workspaceContractVersion: semanticVersionSchema.nullable(),
        workspacePolicyHash: nullableHashSchema,
        workspaceConfigurationHash: nullableHashSchema,
        sandboxRunnerVersion: semanticVersionSchema.nullable(),
        sandboxContractVersion: semanticVersionSchema.nullable(),
        sandboxSanitizerVersion: semanticVersionSchema.nullable(),
        sandboxHelperAbiVersion: semanticVersionSchema.nullable(),
        sandboxDependencySnapshotHash: nullableHashSchema,
        sandboxPolicyId: z.string().min(1).max(64).nullable(),
        sandboxPolicyVersion: semanticVersionSchema.nullable(),
        sandboxPolicyHash: nullableHashSchema,
        sandboxCommandPolicyHash: nullableHashSchema,
        sandboxLimitsHash: nullableHashSchema,
        sandboxAdapter: z.string().min(1).max(64).nullable(),
        sandboxImageDigest: nullableKnowledgeHashSchema,
        sandboxImageId: z.string().min(1).max(256).nullable(),
        sandboxPlatform: z.string().min(1).max(128).nullable(),
        sandboxRuntimeName: z.string().min(1).max(128).nullable(),
        sandboxRuntimeVersion: z.string().min(1).max(128).nullable(),
        toolchainVersions: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    result.stages.forEach((stage, index) => {
      if (stage.stageId !== factoryPipelineStageIdSchema.options[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'The Factory stages are not in canonical order.',
        });
      }
    });
    if (result.hashes.factoryResultHash !== result.lineage.factoryResultHash) {
      context.addIssue({
        code: 'custom',
        path: ['lineage', 'factoryResultHash'],
        message: 'The Factory lineage correlation is invalid.',
      });
    }
  });

const rawHistoryDetailSchema = rawHistoryItemSchema.extend({
  executionId: executionIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  requestId: z.string().min(1).max(128).nullable(),
  metadata: z
    .object({
      engineVersion: semanticVersionSchema,
      contractVersion: semanticVersionSchema,
      attempt: z.number().int().positive(),
    })
    .strict(),
  job: z
    .object({
      jobId: jobIdSchema,
      status: jobStatusSchema,
      queuedAt: z.string().datetime({ offset: true }),
      startedAt: nullableDateTimeSchema,
      finishedAt: nullableDateTimeSchema,
    })
    .strict()
    .nullable(),
  hashes: rawHashesSchema,
  lineage: rawLineageSchema.nullable(),
  provenance: rawProvenanceSchema.nullable(),
  factoryResult: rawFactoryResultSchema.nullable(),
});

const rawTimelineStageSchema = z
  .object({
    stageId: factoryTimelineStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: stageStatusSchema,
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: nullableMetricSchema,
    requestId: z.string().min(1).max(128).nullable(),
    executionId: executionIdSchema,
  })
  .passthrough();

const rawTimelineEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: observabilityEventTypeSchema,
    stageId: observabilityStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: stageStatusSchema,
    startedAt: nullableDateTimeSchema,
    finishedAt: nullableDateTimeSchema,
    durationMs: nullableMetricSchema,
    requestId: z.string().min(1).max(128).nullable(),
    executionId: executionIdSchema,
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .passthrough();

const rawStageMetricsSchema = z
  .object({
    stageId: agentStageIdSchema,
    durationMs: nullableMetricSchema,
    promptBytes: nullableMetricSchema,
    completionBytes: nullableMetricSchema,
    inputTokens: nullableMetricSchema,
    outputTokens: nullableMetricSchema,
    totalTokens: nullableMetricSchema,
    providerLatencyMs: nullableMetricSchema,
    validationDurationMs: nullableMetricSchema,
    artifactGenerationDurationMs: nullableMetricSchema,
  })
  .strict();

const rawTimelineSummarySchema = z
  .object({
    executionId: executionIdSchema,
    workflowStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    readinessFinal: z.string().min(1).max(64).nullable(),
    totalDurationMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    totalCostEstimate: z
      .object({
        amount: z.number().finite().nonnegative(),
        currency: z.literal('USD'),
        rateCardVersion: semanticVersionSchema,
      })
      .strict()
      .nullable(),
    executedStages: z.array(factoryTimelineStageIdSchema).max(10),
    skippedStages: z.array(factoryTimelineStageIdSchema).max(10),
    hashes: rawHashesSchema,
    factoryStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']).optional(),
    factoryResultHash: z.string().regex(HASH_PATTERN).optional(),
  })
  .passthrough();

const rawTimelineSchema = z
  .object({
    observabilityVersion: z.enum(['1.0.0', '2.0.0']),
    executionId: executionIdSchema,
    workflowId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128).nullable(),
    revision: z.number().int().nonnegative(),
    status: terminalStatusSchema,
    updatedAt: z.string().datetime({ offset: true }),
    events: z.array(rawTimelineEventSchema).max(64),
    stages: z.array(rawTimelineStageSchema).min(4).max(10),
    stageMetrics: z.array(rawStageMetricsSchema).length(3),
    summary: rawTimelineSummarySchema.nullable(),
  })
  .passthrough()
  .superRefine((timeline, context) => {
    const expectedStageOrder =
      timeline.observabilityVersion === '1.0.0'
        ? legacyStageIdSchema.options
        : factoryTimelineStageIdSchema.options;
    if (timeline.stages.length !== expectedStageOrder.length) {
      context.addIssue({
        code: 'custom',
        path: ['stages'],
        message: 'The timeline stage set is invalid for its observability version.',
      });
    }
    timeline.events.forEach((event, index) => {
      if (event.executionId !== timeline.executionId || event.sequence !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['events', index],
          message: 'The timeline event correlation is invalid.',
        });
      }
    });
    timeline.stages.forEach((stage, index) => {
      if (stage.stageId !== expectedStageOrder[index]) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'stageId'],
          message: 'The timeline stages are not in canonical order.',
        });
      }
      if (stage.executionId !== timeline.executionId) {
        context.addIssue({
          code: 'custom',
          path: ['stages', index, 'executionId'],
          message: 'The timeline stage correlation is invalid.',
        });
      }
    });
    if (timeline.summary !== null && timeline.summary.executionId !== timeline.executionId) {
      context.addIssue({
        code: 'custom',
        path: ['summary', 'executionId'],
        message: 'The timeline summary correlation is invalid.',
      });
    }
  });

const responseMetadataSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    apiVersion: semanticVersionSchema,
    executionId: executionIdSchema.optional(),
  })
  .passthrough();

const rawErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: responseMetadataSchema,
    errors: z
      .array(
        z
          .object({
            code: z.string().min(1).max(128),
            message: z.string().min(1).max(300),
          })
          .passthrough(),
      )
      .min(1)
      .max(100),
  })
  .strict();

function successEnvelopeSchema<Data extends z.ZodType>(data: Data) {
  return z
    .object({
      success: z.literal(true),
      data,
      metadata: responseMetadataSchema,
      errors: z.tuple([]),
    })
    .strict();
}

const rawHistoryPageEnvelopeSchema = successEnvelopeSchema(rawHistoryPageSchema);
const rawHistoryDetailEnvelopeSchema = successEnvelopeSchema(rawHistoryDetailSchema);
const rawTimelineEnvelopeSchema = successEnvelopeSchema(rawTimelineSchema);

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ExecutionHistoryClientOptions {
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: FetchImplementation;
}

export type ExecutionHistoryClientErrorCode =
  | 'INVALID_FILTERS'
  | 'INVALID_EXECUTION_ID'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'INVALID_RESPONSE';

interface ExecutionHistoryClientErrorOptions {
  readonly code: ExecutionHistoryClientErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly cause?: unknown;
}

export class ExecutionHistoryClientError extends Error {
  readonly code: ExecutionHistoryClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(message: string, options: ExecutionHistoryClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionHistoryClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

async function request(
  endpoint: string,
  options: ExecutionHistoryClientOptions,
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  try {
    return await fetchImplementation(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true || isAbortError(error)) {
      throw new ExecutionHistoryClientError('The history request was cancelled.', {
        code: 'REQUEST_ABORTED',
        cause: error,
      });
    }
    throw new ExecutionHistoryClientError('Execution history is unavailable.', {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new ExecutionHistoryClientError('The execution history response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ExecutionHistoryClientError('The execution history response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: error,
    });
  }
}

async function parseEnvelope<Output>(
  response: Response,
  schema: z.ZodType<Output>,
): Promise<Output> {
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsedError = rawErrorEnvelopeSchema.safeParse(payload);
    if (!parsedError.success) {
      throw new ExecutionHistoryClientError('Execution history is unavailable.', {
        code: 'API_ERROR',
        status: response.status,
      });
    }
    throw new ExecutionHistoryClientError(parsedError.data.errors[0]!.message, {
      code: 'API_ERROR',
      status: response.status,
      requestId: parsedError.data.metadata.requestId,
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ExecutionHistoryClientError('The execution history response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function projectItem(raw: z.output<typeof rawHistoryItemSchema>): ExecutionHistoryItem {
  return Object.freeze({
    executionId: raw.executionId,
    workflowId: raw.workflowId,
    projectName: raw.projectName,
    status: raw.status,
    readiness: raw.readiness,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    durationMs: raw.durationMs,
  });
}

function projectDetail(raw: z.output<typeof rawHistoryDetailSchema>): ExecutionHistoryDetail {
  const lineage =
    raw.lineage === null
      ? null
      : Object.freeze({
          outputs: Object.freeze({ ...raw.lineage.outputs }),
          handoffs: Object.freeze(
            raw.lineage.handoffs.map((handoff) =>
              Object.freeze({
                from: handoff.from,
                to: handoff.to,
                specification: handoff.specification,
                verified: handoff.verified,
              }),
            ),
          ),
        });
  const provenance =
    raw.provenance === null
      ? null
      : Object.freeze({
          stages: Object.freeze(
            raw.provenance.stages.map((stage) =>
              Object.freeze({
                stage: stage.stage,
                agentVersion: stage.agentVersion,
                outcome: stage.outcome,
                readiness: stage.readiness,
                hashes: Object.freeze({
                  assetBundleHash: stage.hashes.assetBundleHash,
                  knowledgeContextHash: stage.hashes.knowledgeContextHash,
                  promptHash: stage.hashes.promptHash,
                  responseHash: stage.hashes.responseHash,
                  validationHash: stage.hashes.validationHash,
                  generationHash: stage.hashes.generationHash,
                  artifactHashes: Object.freeze([...stage.hashes.artifactHashes]),
                }),
              }),
            ),
          ),
        });
  const factoryResult =
    raw.factoryResult === null
      ? null
      : Object.freeze({
          ...raw.factoryResult,
          hashes: Object.freeze({ ...raw.factoryResult.hashes }),
          failure:
            raw.factoryResult.failure === null
              ? null
              : Object.freeze({ ...raw.factoryResult.failure }),
          stages: Object.freeze(
            raw.factoryResult.stages.map((stage) => Object.freeze({ ...stage })),
          ),
          lineage: Object.freeze({ ...raw.factoryResult.lineage }),
          provenance: Object.freeze({
            ...raw.factoryResult.provenance,
            toolchainVersions: Object.freeze({
              ...raw.factoryResult.provenance.toolchainVersions,
            }),
          }),
        });

  return Object.freeze({
    ...projectItem(raw),
    executionId: raw.executionId,
    createdAt: raw.createdAt,
    requestId: raw.requestId,
    metadata: Object.freeze({ ...raw.metadata }),
    job: raw.job === null ? null : Object.freeze({ ...raw.job }),
    hashes: Object.freeze({ ...raw.hashes }),
    lineage,
    provenance,
    factoryResult,
  });
}

function projectTimeline(raw: z.output<typeof rawTimelineSchema>): ExecutionHistoryTimeline {
  const summary =
    raw.summary === null
      ? null
      : Object.freeze({
          executionId: raw.summary.executionId,
          workflowStatus: raw.summary.workflowStatus,
          readinessFinal: raw.summary.readinessFinal,
          totalDurationMs: raw.summary.totalDurationMs,
          totalTokens: raw.summary.totalTokens,
          totalCostEstimate:
            raw.summary.totalCostEstimate === null
              ? null
              : Object.freeze({ ...raw.summary.totalCostEstimate }),
          executedStages: Object.freeze([...raw.summary.executedStages]),
          skippedStages: Object.freeze([...raw.summary.skippedStages]),
          hashes: Object.freeze({ ...raw.summary.hashes }),
          ...(raw.summary.factoryStatus === undefined
            ? {}
            : { factoryStatus: raw.summary.factoryStatus }),
          ...(raw.summary.factoryResultHash === undefined
            ? {}
            : { factoryResultHash: raw.summary.factoryResultHash }),
        });
  return Object.freeze({
    observabilityVersion: raw.observabilityVersion,
    revision: raw.revision,
    executionId: raw.executionId,
    workflowId: raw.workflowId,
    requestId: raw.requestId,
    status: raw.status,
    updatedAt: raw.updatedAt,
    events: Object.freeze(
      raw.events.map((event) =>
        Object.freeze({
          sequence: event.sequence,
          type: event.type,
          stageId: event.stageId,
          stageName: event.stageName,
          status: event.status,
          startedAt: event.startedAt,
          finishedAt: event.finishedAt,
          durationMs: event.durationMs,
          requestId: event.requestId,
          executionId: event.executionId,
          errorCode: event.errorCode,
        }),
      ),
    ),
    stages: Object.freeze(
      raw.stages.map((stage) =>
        Object.freeze({
          stageId: stage.stageId,
          stageName: stage.stageName,
          status: stage.status,
          startedAt: stage.startedAt,
          finishedAt: stage.finishedAt,
          durationMs: stage.durationMs,
          requestId: stage.requestId,
          executionId: stage.executionId,
        }),
      ),
    ),
    stageMetrics: Object.freeze(raw.stageMetrics.map((metrics) => Object.freeze({ ...metrics }))),
    summary,
  }) as ExecutionHistoryTimeline;
}

function executionEndpoint(executionId: string): string {
  return `/api/executions/${encodeURIComponent(executionId)}`;
}

function assertExecutionId(executionId: string): void {
  if (!executionIdSchema.safeParse(executionId).success) {
    throw new ExecutionHistoryClientError('The execution identifier is invalid.', {
      code: 'INVALID_EXECUTION_ID',
    });
  }
}

export async function listExecutions(
  filters: ExecutionHistoryFilters = {},
  options: ExecutionHistoryClientOptions = {},
): Promise<ExecutionHistoryPage> {
  const parsedFilters = historyFiltersSchema.safeParse(filters);
  if (!parsedFilters.success) {
    throw new ExecutionHistoryClientError('The execution history filters are invalid.', {
      code: 'INVALID_FILTERS',
      cause: parsedFilters.error,
    });
  }

  const search = new URLSearchParams();
  const validated = parsedFilters.data;
  if (validated.status !== undefined) search.set('status', validated.status);
  if (validated.readiness !== undefined) search.set('readiness', validated.readiness);
  if (validated.createdAfter !== undefined) search.set('createdAfter', validated.createdAfter);
  if (validated.createdBefore !== undefined) search.set('createdBefore', validated.createdBefore);
  if (validated.limit !== undefined) search.set('limit', String(validated.limit));
  if (validated.cursor !== undefined) search.set('cursor', validated.cursor);
  const endpoint = search.size === 0 ? EXECUTIONS_ENDPOINT : `${EXECUTIONS_ENDPOINT}?${search}`;
  const response = await request(endpoint, options);
  const envelope = await parseEnvelope(response, rawHistoryPageEnvelopeSchema);

  return Object.freeze({
    items: Object.freeze(envelope.data.items.map(projectItem)),
    nextCursor: envelope.data.nextCursor,
  });
}

export async function getExecution(
  executionId: string,
  options: ExecutionHistoryClientOptions = {},
): Promise<ExecutionHistoryDetail> {
  assertExecutionId(executionId);
  const response = await request(executionEndpoint(executionId), options);
  const envelope = await parseEnvelope(response, rawHistoryDetailEnvelopeSchema);
  if (envelope.data.executionId !== executionId) {
    throw new ExecutionHistoryClientError('The execution history response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return projectDetail(envelope.data);
}

export async function getExecutionTimeline(
  executionId: string,
  options: ExecutionHistoryClientOptions = {},
): Promise<ExecutionHistoryTimeline> {
  assertExecutionId(executionId);
  const response = await request(`${executionEndpoint(executionId)}/timeline`, options);
  const envelope = await parseEnvelope(response, rawTimelineEnvelopeSchema);
  if (envelope.data.executionId !== executionId) {
    throw new ExecutionHistoryClientError('The execution history response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return projectTimeline(envelope.data);
}

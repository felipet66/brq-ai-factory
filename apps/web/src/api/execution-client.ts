import { z } from 'zod';

import {
  FRONTEND_EXECUTION_PROFILE,
  type FrontendExecutionProfile,
} from '@/config/frontend-execution-profile';

import type { ExecutionSummary } from './execution-contracts';

const EXECUTIONS_ENDPOINT = '/api/executions';
const TIMELINE_POLL_INTERVAL_MS = 750;
const TIMELINE_REQUEST_TIMEOUT_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^request-[0-9a-f-]{36}$/;

const executionInputSchema = z
  .object({
    projectName: z.string().trim().min(1).max(200),
    objective: z.string().trim().min(1).max(16_000),
  })
  .strict();

const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );

const agentProfileSchema = z
  .object({
    agentVersion: semanticVersionSchema,
    model: z.string().trim().min(1).max(200),
  })
  .strict();

const executionProfileSchema = z
  .object({
    productOwner: agentProfileSchema,
    developer: agentProfileSchema,
    qa: agentProfileSchema,
  })
  .strict();

const hashSchema = z.string().regex(HASH_PATTERN);
const nullableHashSchema = hashSchema.nullable();
const executionStatusSchema = z.enum(['SUCCESS', 'FAILED', 'CANCELLED']);
const workflowStageSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const agentOutcomeSchema = z.enum(['GENERATED', 'VALIDATION_REJECTED']);
const observabilityStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
]);
const observabilityStageIdSchema = z.enum([
  'EXECUTION',
  'KNOWLEDGE',
  'PRODUCT_OWNER',
  'DEVELOPER',
  'QA',
  'WORKFLOW',
]);
const observableAgentStageIdSchema = z.enum(['PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const executionTimelineStageIdSchema = z.enum(['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA']);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const nullableMetricSchema = z.number().int().nonnegative().nullable();

const rawLineageSchema = z
  .object({
    outputs: z
      .object({
        productOwnerSpecificationHash: z.string().nullable(),
        technicalSpecificationHash: z.string().nullable(),
        qaSpecificationHash: z.string().nullable(),
      })
      .passthrough(),
    handoffs: z.array(z.object({ verified: z.literal(true) }).passthrough()).max(3),
  })
  .passthrough();

const rawProvenanceStageSchema = z
  .object({
    stage: workflowStageSchema,
    agentVersion: z.string().min(1).max(128),
    outcome: agentOutcomeSchema,
    readiness: z.string().min(1).max(64).nullable(),
  })
  .passthrough();

const rawExecutionDataSchema = z
  .object({
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    status: executionStatusSchema,
    metrics: z
      .object({
        observed: z.object({ totalDurationMs: z.number().int().nonnegative() }).passthrough(),
      })
      .passthrough(),
    hashes: z
      .object({
        executionRequestHash: hashSchema,
        workflowRequestHash: hashSchema,
        workflowHash: nullableHashSchema,
        lineageHash: nullableHashSchema,
        provenanceHash: nullableHashSchema,
        executionHash: hashSchema,
      })
      .strict(),
    lineage: rawLineageSchema.nullable(),
    provenance: z
      .object({ stages: z.array(rawProvenanceStageSchema).max(3) })
      .passthrough()
      .nullable(),
  })
  .passthrough();

const rawObservabilityEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    type: z.enum([
      'execution.started',
      'execution.finished',
      'execution.failed',
      'stage.started',
      'stage.finished',
      'stage.failed',
    ]),
    stageId: observabilityStageIdSchema,
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: nullableMetricSchema,
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    errorCode: z.string().min(1).max(128).nullable(),
  })
  .strict();

const rawObservabilityStageSchema = z
  .object({
    stageId: z.enum(['KNOWLEDGE', 'PRODUCT_OWNER', 'DEVELOPER', 'QA']),
    stageName: z.string().min(1).max(64),
    status: observabilityStatusSchema,
    startedAt: isoDateTimeSchema.nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    durationMs: nullableMetricSchema,
    requestId: z.string().min(1).max(128).nullable(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
  })
  .strict();

const rawStageMetricsSchema = z
  .object({
    stageId: observableAgentStageIdSchema,
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

const rawObservabilitySummarySchema = z
  .object({
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowStatus: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']),
    readinessFinal: z.string().min(1).max(64).nullable(),
    totalDurationMs: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    totalCostEstimate: z
      .object({
        amount: z.number().nonnegative().finite(),
        currency: z.literal('USD'),
        rateCardVersion: semanticVersionSchema,
      })
      .strict()
      .nullable(),
    executedStages: z.array(executionTimelineStageIdSchema).max(4),
    skippedStages: z.array(executionTimelineStageIdSchema).max(4),
    hashes: z
      .object({
        executionRequestHash: hashSchema,
        workflowRequestHash: hashSchema,
        workflowHash: nullableHashSchema,
        lineageHash: nullableHashSchema,
        provenanceHash: nullableHashSchema,
        executionHash: hashSchema,
      })
      .strict(),
  })
  .strict();

const rawObservabilitySnapshotSchema = z
  .object({
    observabilityVersion: semanticVersionSchema,
    revision: z.number().int().nonnegative(),
    executionId: z.string().regex(/^execution-[a-f0-9]{32}$/),
    workflowId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128).nullable(),
    status: z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']),
    updatedAt: isoDateTimeSchema,
    events: z.array(rawObservabilityEventSchema).max(64),
    stages: z.array(rawObservabilityStageSchema).length(4),
    stageMetrics: z.array(rawStageMetricsSchema).length(3),
    summary: rawObservabilitySummarySchema.nullable(),
  })
  .strict();

const responseMetadataSchema = z
  .object({
    requestId: z.string().regex(REQUEST_ID_PATTERN),
    apiVersion: semanticVersionSchema,
    executionId: z
      .string()
      .regex(/^execution-[a-f0-9]{32}$/)
      .optional(),
  })
  .strict();

const rawSuccessEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: rawExecutionDataSchema,
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const rawTimelineEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: rawObservabilitySnapshotSchema,
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

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
            path: z.string().min(1).max(256).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

type ExecutionInput = z.input<typeof executionInputSchema>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TechnicalIdFactory = () => string;
type ExecutionObservabilityView = Exclude<ExecutionSummary['observability'], null>;

interface ExecutionClientOptions {
  readonly signal?: AbortSignal;
  readonly profile?: FrontendExecutionProfile;
  readonly idFactory?: TechnicalIdFactory;
  readonly fetchImplementation?: FetchImplementation;
  readonly onObservability?: (observability: ExecutionObservabilityView) => void;
  readonly pollIntervalMs?: number;
  readonly timelineRequestTimeoutMs?: number;
}

type ExecutionClientErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CONFIGURATION'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'
  | 'API_ERROR'
  | 'INVALID_RESPONSE';

interface ExecutionClientErrorOptions {
  readonly code: ExecutionClientErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly executionId?: string;
  readonly cause?: unknown;
}

export class ExecutionClientError extends Error {
  readonly code: ExecutionClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly executionId: string | null;

  constructor(message: string, options: ExecutionClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.executionId = options.executionId ?? null;
  }
}

function defaultIdFactory(): string {
  return globalThis.crypto.randomUUID();
}

function buildTechnicalIdentifiers(idFactory: TechnicalIdFactory) {
  const correlationId = idFactory();
  if (!UUID_PATTERN.test(correlationId)) {
    throw new ExecutionClientError('A configuração técnica da execução é inválida.', {
      code: 'INVALID_CONFIGURATION',
    });
  }

  /*
   * Temporary MVP compatibility boundary: the current HTTP API requires workflowId and the
   * agentExecutionIds. These identifiers are not a permanent frontend responsibility and should
   * move behind the HTTP boundary when that contract evolves. requestId and executionId are
   * already generated exclusively by the backend.
   */
  return Object.freeze({
    workflowId: `workflow-${correlationId}`,
    productOwnerAgentExecutionId: `product-owner-${correlationId}`,
    developerAgentExecutionId: `developer-${correlationId}`,
    qaAgentExecutionId: `qa-${correlationId}`,
  });
}

function createHttpRequest(
  input: z.output<typeof executionInputSchema>,
  profile: FrontendExecutionProfile,
  idFactory: TechnicalIdFactory,
) {
  const ids = buildTechnicalIdentifiers(idFactory);
  return {
    workflowId: ids.workflowId,
    demand: {
      title: input.projectName,
      description: input.objective,
    },
    agents: {
      productOwner: {
        agentExecutionId: ids.productOwnerAgentExecutionId,
        ...profile.productOwner,
      },
      developer: {
        agentExecutionId: ids.developerAgentExecutionId,
        ...profile.developer,
      },
      qa: {
        agentExecutionId: ids.qaAgentExecutionId,
        ...profile.qa,
      },
    },
  };
}

function projectObservability(
  snapshot: z.output<typeof rawObservabilitySnapshotSchema>,
): ExecutionObservabilityView {
  const summary =
    snapshot.summary === null
      ? null
      : Object.freeze({
          totalTokens: snapshot.summary.totalTokens,
          totalCostEstimate:
            snapshot.summary.totalCostEstimate === null
              ? null
              : Object.freeze({ ...snapshot.summary.totalCostEstimate }),
          executedStages: Object.freeze([...snapshot.summary.executedStages]),
          skippedStages: Object.freeze([...snapshot.summary.skippedStages]),
        });

  return Object.freeze({
    revision: snapshot.revision,
    status: snapshot.status,
    stages: Object.freeze(
      snapshot.stages.map((stage) =>
        Object.freeze({
          stageId: stage.stageId,
          stageName: stage.stageName,
          status: stage.status,
          durationMs: stage.durationMs,
        }),
      ),
    ),
    stageMetrics: Object.freeze(
      snapshot.stageMetrics.map((metrics) => Object.freeze({ ...metrics })),
    ),
    summary,
  });
}

function projectExecutionSummary(
  data: z.output<typeof rawExecutionDataSchema>,
  observability: ExecutionSummary['observability'],
): ExecutionSummary {
  const lineage =
    data.lineage === null
      ? null
      : Object.freeze({
          outputCount: Object.values(data.lineage.outputs).filter((value) => value !== null).length,
          verifiedHandoffs: data.lineage.handoffs.length,
        });
  const provenance =
    data.provenance === null
      ? null
      : Object.freeze({
          stages: Object.freeze(
            data.provenance.stages.map((stage) =>
              Object.freeze({
                stage: stage.stage,
                agentVersion: stage.agentVersion,
                outcome: stage.outcome,
                readiness: stage.readiness,
              }),
            ),
          ),
        });
  const readiness =
    data.provenance?.stages.find((stage) => stage.stage === 'QA')?.readiness ?? null;

  return Object.freeze({
    executionId: data.executionId,
    status: data.status,
    durationMs: data.metrics.observed.totalDurationMs,
    readiness,
    hashes: Object.freeze({ ...data.hashes }),
    lineage,
    provenance,
    observability,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: error,
    });
  }
}

async function parseExecutionHttpResponse(
  response: Response,
): Promise<z.output<typeof rawExecutionDataSchema>> {
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsedError = rawErrorEnvelopeSchema.safeParse(payload);
    if (!parsedError.success) {
      throw new ExecutionClientError('A execução não pôde ser concluída.', {
        code: 'API_ERROR',
        status: response.status,
      });
    }
    throw new ExecutionClientError(parsedError.data.errors[0]!.message, {
      code: 'API_ERROR',
      status: response.status,
      requestId: parsedError.data.metadata.requestId,
      ...(parsedError.data.metadata.executionId === undefined
        ? {}
        : { executionId: parsedError.data.metadata.executionId }),
    });
  }

  const parsedSuccess = rawSuccessEnvelopeSchema.safeParse(payload);
  if (
    !parsedSuccess.success ||
    parsedSuccess.data.metadata.executionId !== parsedSuccess.data.data.executionId
  ) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return parsedSuccess.data.data;
}

type RawObservabilitySnapshot = z.output<typeof rawObservabilitySnapshotSchema>;
type TimelineReadOutcome =
  | { readonly status: 'available'; readonly snapshot: RawObservabilitySnapshot }
  | { readonly status: 'not-found' }
  | { readonly status: 'unavailable' };

function timelineEndpoint(id: string): string {
  return `/api/executions/${encodeURIComponent(id)}/timeline`;
}

function isTerminalObservabilityStatus(
  status: RawObservabilitySnapshot['status'],
): status is 'SUCCESS' | 'FAILED' | 'CANCELLED' {
  return status !== 'RUNNING';
}

function isCorrelatedSnapshot(snapshot: RawObservabilitySnapshot, id: string): boolean {
  if (id.startsWith('execution-') && snapshot.executionId !== id) return false;
  if (id.startsWith('workflow-') && snapshot.workflowId !== id) return false;
  if (snapshot.summary !== null && snapshot.summary.executionId !== snapshot.executionId)
    return false;
  if (snapshot.events.some((event) => event.executionId !== snapshot.executionId)) return false;
  return !snapshot.stages.some((stage) => stage.executionId !== snapshot.executionId);
}

async function readTimeline(
  id: string,
  fetchImplementation: FetchImplementation,
  signal?: AbortSignal,
  timeoutMs = TIMELINE_REQUEST_TIMEOUT_MS,
): Promise<TimelineReadOutcome> {
  if (signal?.aborted === true) return { status: 'unavailable' };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachCallerAbort: (() => void) | undefined;
  const unavailable = Object.freeze({ status: 'unavailable' } as const);
  const operation = (async (): Promise<TimelineReadOutcome> => {
    try {
      const response = await fetchImplementation(timelineEndpoint(id), {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 404) return { status: 'not-found' };
      if (!response.ok) return unavailable;

      const payload = await parseJson(response);
      const parsed = rawTimelineEnvelopeSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.metadata.executionId !== parsed.data.data.executionId ||
        !isCorrelatedSnapshot(parsed.data.data, id)
      ) {
        return unavailable;
      }
      return { status: 'available', snapshot: parsed.data.data };
    } catch {
      return { status: 'unavailable' };
    }
  })();
  const boundary = new Promise<TimelineReadOutcome>((resolve) => {
    const stop = (): void => {
      controller.abort();
      resolve(unavailable);
    };
    timer = setTimeout(stop, timeoutMs);
    if (signal !== undefined) {
      signal.addEventListener('abort', stop, { once: true });
      detachCallerAbort = () => signal.removeEventListener('abort', stop);
    }
  });

  try {
    return await Promise.race([operation, boundary]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    detachCallerAbort?.();
    controller.abort();
  }
}

function notifyObservability(
  callback: ExecutionClientOptions['onObservability'],
  snapshot: RawObservabilitySnapshot,
): void {
  try {
    callback?.(projectObservability(snapshot));
  } catch {
    // Observability is intentionally isolated from the workflow transport.
  }
}

function waitForNextPoll(durationMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const complete = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', complete);
      resolve();
    };
    const timer = setTimeout(complete, durationMs);
    signal.addEventListener('abort', complete, { once: true });
  });
}

function effectivePollInterval(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 60_000
    ? value
    : TIMELINE_POLL_INTERVAL_MS;
}

function effectiveTimelineRequestTimeout(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1 && value <= 60_000
    ? value
    : TIMELINE_REQUEST_TIMEOUT_MS;
}

async function pollTimeline(
  workflowId: string,
  options: {
    readonly callback: ExecutionClientOptions['onObservability'];
    readonly fetchImplementation: FetchImplementation;
    readonly intervalMs: number;
    readonly requestTimeoutMs: number;
    readonly signal: AbortSignal;
  },
): Promise<RawObservabilitySnapshot | null> {
  let latest: RawObservabilitySnapshot | null = null;

  while (!options.signal.aborted) {
    const outcome = await readTimeline(
      workflowId,
      options.fetchImplementation,
      options.signal,
      options.requestTimeoutMs,
    );
    if (options.signal.aborted) break;
    if (outcome.status === 'unavailable') break;
    if (outcome.status === 'available') {
      if (latest === null || outcome.snapshot.revision > latest.revision) {
        latest = outcome.snapshot;
        notifyObservability(options.callback, latest);
      }
      if (isTerminalObservabilityStatus(outcome.snapshot.status)) break;
    }
    await waitForNextPoll(options.intervalMs, options.signal);
  }

  return latest;
}

function mapPostTransportError(error: unknown, signal?: AbortSignal): ExecutionClientError {
  if (signal?.aborted === true || isAbortError(error)) {
    return new ExecutionClientError('A solicitação de execução foi cancelada.', {
      code: 'REQUEST_ABORTED',
      cause: error,
    });
  }
  return new ExecutionClientError('Não foi possível conectar ao serviço de execução.', {
    code: 'NETWORK_ERROR',
    cause: error,
  });
}

export async function executeWorkflow(
  input: ExecutionInput,
  options: ExecutionClientOptions = {},
): Promise<ExecutionSummary> {
  const parsedInput = executionInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new ExecutionClientError('Informe um nome de projeto e um objetivo válidos.', {
      code: 'INVALID_INPUT',
    });
  }

  const parsedProfile = executionProfileSchema.safeParse(
    options.profile ?? FRONTEND_EXECUTION_PROFILE,
  );
  if (!parsedProfile.success) {
    throw new ExecutionClientError('A configuração técnica da execução é inválida.', {
      code: 'INVALID_CONFIGURATION',
    });
  }

  const body = createHttpRequest(
    parsedInput.data,
    parsedProfile.data,
    options.idFactory ?? defaultIdFactory,
  );
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const timelineRequestTimeoutMs = effectiveTimelineRequestTimeout(
    options.timelineRequestTimeoutMs,
  );
  const pollController = new AbortController();
  const abortPolling = (): void => pollController.abort();
  options.signal?.addEventListener('abort', abortPolling, { once: true });

  let responsePromise: Promise<Response>;
  try {
    responsePromise = fetchImplementation(EXECUTIONS_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    options.signal?.removeEventListener('abort', abortPolling);
    throw mapPostTransportError(error, options.signal);
  }

  const polling =
    options.onObservability === undefined
      ? Promise.resolve(null)
      : pollTimeline(body.workflowId, {
          callback: options.onObservability,
          fetchImplementation,
          intervalMs: effectivePollInterval(options.pollIntervalMs),
          requestTimeoutMs: timelineRequestTimeoutMs,
          signal: pollController.signal,
        });

  let response: Response | undefined;
  let postError: unknown;
  try {
    response = await responsePromise;
  } catch (error) {
    postError = error;
  } finally {
    pollController.abort();
    options.signal?.removeEventListener('abort', abortPolling);
  }
  const liveSnapshot = await polling;

  if (postError !== undefined) throw mapPostTransportError(postError, options.signal);
  if (response === undefined) throw mapPostTransportError(undefined, options.signal);

  let data: z.output<typeof rawExecutionDataSchema>;
  try {
    data = await parseExecutionHttpResponse(response);
  } catch (error) {
    const executionId = error instanceof ExecutionClientError ? error.executionId : null;
    if (executionId !== null && options.signal?.aborted !== true) {
      const terminal = await readTimeline(
        executionId,
        fetchImplementation,
        options.signal,
        timelineRequestTimeoutMs,
      );
      if (terminal.status === 'available')
        notifyObservability(options.onObservability, terminal.snapshot);
    }
    throw error;
  }

  const terminal = await readTimeline(
    data.executionId,
    fetchImplementation,
    options.signal,
    timelineRequestTimeoutMs,
  );
  const finalSnapshot =
    terminal.status === 'available' && terminal.snapshot.status === data.status
      ? terminal.snapshot
      : liveSnapshot?.status === data.status
        ? liveSnapshot
        : null;
  if (
    finalSnapshot !== null &&
    (liveSnapshot === null || finalSnapshot.revision > liveSnapshot.revision)
  ) {
    notifyObservability(options.onObservability, finalSnapshot);
  }

  return projectExecutionSummary(
    data,
    finalSnapshot === null ? null : projectObservability(finalSnapshot),
  );
}

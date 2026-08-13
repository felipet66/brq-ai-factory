import { z } from 'zod';

import {
  FRONTEND_EXECUTION_PROFILE,
  type FrontendExecutionProfile,
} from '@/config/frontend-execution-profile';

import type { ExecutionJobStatus, ExecutionJobView } from './execution-contracts';

const EXECUTIONS_ENDPOINT = '/api/executions';
export const EXECUTION_POLL_INTERVAL_MS = 750;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^request-[0-9a-f-]{36}$/;

const executionInputSchema = z
  .object({
    deliveryMode: z.enum(['GREENFIELD', 'CHANGE']),
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

const executionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/);
const jobIdSchema = z.string().regex(/^job-[a-f0-9]{32}$/);
const jobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']);
const isoDateTimeSchema = z.string().datetime({ offset: true });

const responseMetadataSchema = z
  .object({
    requestId: z.string().regex(REQUEST_ID_PATTERN),
    apiVersion: semanticVersionSchema,
    executionId: executionIdSchema.optional(),
  })
  .strict();

const executionAcceptedSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        executionId: executionIdSchema,
        jobId: jobIdSchema,
        status: z.literal('QUEUED'),
      })
      .strict(),
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const jobLookupSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        jobId: jobIdSchema,
        executionId: executionIdSchema,
        status: jobStatusSchema,
        queuedAt: isoDateTimeSchema,
        startedAt: isoDateTimeSchema.nullable(),
        finishedAt: isoDateTimeSchema.nullable(),
      })
      .strict(),
    metadata: responseMetadataSchema,
    errors: z.tuple([]),
  })
  .strict();

const errorEnvelopeSchema = z
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

export type ExecutionInput = z.input<typeof executionInputSchema>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TechnicalIdFactory = () => string;

export interface ExecutionClientOptions {
  readonly signal?: AbortSignal;
  readonly profile?: FrontendExecutionProfile;
  readonly idFactory?: TechnicalIdFactory;
  readonly fetchImplementation?: FetchImplementation;
  readonly onJobUpdate?: (job: ExecutionJobView) => void;
  readonly pollIntervalMs?: number;
}

type ExecutionClientErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_JOB_ID'
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
   * move behind the HTTP boundary when that contract evolves. requestId, executionId and jobId are
   * generated exclusively by the backend.
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
    deliveryMode: input.deliveryMode,
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function transportError(error: unknown, signal?: AbortSignal): ExecutionClientError {
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

async function parseHttpResponse(
  response: Response,
  successSchema: typeof executionAcceptedSchema | typeof jobLookupSchema,
): Promise<z.output<typeof executionAcceptedSchema> | z.output<typeof jobLookupSchema>> {
  const payload = await parseJson(response);
  if (!response.ok) {
    const parsedError = errorEnvelopeSchema.safeParse(payload);
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

  const parsedSuccess = successSchema.safeParse(payload);
  if (!parsedSuccess.success) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return parsedSuccess.data;
}

function projectJob(job: {
  readonly executionId: string;
  readonly jobId: string;
  readonly status: ExecutionJobStatus;
  readonly queuedAt?: string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
}): ExecutionJobView {
  return Object.freeze({
    executionId: job.executionId,
    jobId: job.jobId,
    status: job.status,
    queuedAt: job.queuedAt ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  });
}

function notifyJobUpdate(
  callback: ExecutionClientOptions['onJobUpdate'],
  job: ExecutionJobView,
): void {
  try {
    callback?.(job);
  } catch {
    // Presentation updates are intentionally isolated from HTTP transport.
  }
}

function isTerminal(status: ExecutionJobStatus): boolean {
  return status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
}

function effectivePollInterval(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 && value <= 60_000
    ? value
    : EXECUTION_POLL_INTERVAL_MS;
}

function waitForNextPoll(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(transportError(undefined, signal));

  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(transportError(undefined, signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, durationMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function fetchResponse(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted === true) throw transportError(undefined, signal);
  try {
    return await fetchImplementation(input, init);
  } catch (error) {
    throw transportError(error, signal);
  }
}

function validateCorrelation(
  envelope: z.output<typeof executionAcceptedSchema> | z.output<typeof jobLookupSchema>,
): void {
  if (envelope.metadata.executionId !== envelope.data.executionId) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
    });
  }
}

/**
 * Creates an asynchronous execution and returns as soon as the backend accepts its job.
 * Polling is intentionally left to the caller so live experiences can own their lifecycle.
 */
export async function enqueueExecution(
  input: ExecutionInput,
  options: ExecutionClientOptions = {},
): Promise<ExecutionJobView> {
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
  const response = await fetchResponse(
    fetchImplementation,
    EXECUTIONS_ENDPOINT,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    options.signal,
  );
  const accepted = await parseHttpResponse(response, executionAcceptedSchema);
  if (response.status !== 202) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  validateCorrelation(accepted);

  return projectJob(accepted.data);
}

/** Loads one immutable job snapshot without retrying or scheduling another request. */
export async function getJob(
  jobId: string,
  options: ExecutionClientOptions = {},
): Promise<ExecutionJobView> {
  if (!jobIdSchema.safeParse(jobId).success) {
    throw new ExecutionClientError('O identificador do job é inválido.', {
      code: 'INVALID_JOB_ID',
    });
  }

  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const jobResponse = await fetchResponse(
    fetchImplementation,
    `/api/jobs/${encodeURIComponent(jobId)}`,
    {
      method: 'GET',
      cache: 'no-store',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    options.signal,
  );
  const jobEnvelope = await parseHttpResponse(jobResponse, jobLookupSchema);
  if (jobResponse.status !== 200) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: jobResponse.status,
    });
  }
  validateCorrelation(jobEnvelope);
  if (jobEnvelope.data.jobId !== jobId) {
    throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
      code: 'INVALID_RESPONSE',
      status: jobResponse.status,
    });
  }

  return projectJob(jobEnvelope.data);
}

/** Backwards-compatible convenience workflow composed from the two single-call operations. */
export async function executeWorkflow(
  input: ExecutionInput,
  options: ExecutionClientOptions = {},
): Promise<ExecutionJobView> {
  let current = await enqueueExecution(input, options);

  notifyJobUpdate(options.onJobUpdate, current);

  while (!isTerminal(current.status)) {
    await waitForNextPoll(effectivePollInterval(options.pollIntervalMs), options.signal);
    const next = await getJob(current.jobId, options);
    if (next.executionId !== current.executionId) {
      throw new ExecutionClientError('A resposta do serviço de execução é inválida.', {
        code: 'INVALID_RESPONSE',
      });
    }
    current = next;
    notifyJobUpdate(options.onJobUpdate, current);
  }

  return current;
}

import { z } from 'zod';

import {
  FRONTEND_EXECUTION_PROFILE,
  type FrontendExecutionProfile,
} from '@/config/frontend-execution-profile';

import type { ExecutionSummary } from './execution-contracts';

const EXECUTIONS_ENDPOINT = '/api/executions';
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

interface ExecutionClientOptions {
  readonly signal?: AbortSignal;
  readonly profile?: FrontendExecutionProfile;
  readonly idFactory?: TechnicalIdFactory;
  readonly fetchImplementation?: FetchImplementation;
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
  readonly cause?: unknown;
}

export class ExecutionClientError extends Error {
  readonly code: ExecutionClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(message: string, options: ExecutionClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'ExecutionClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
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

function projectExecutionSummary(data: z.output<typeof rawExecutionDataSchema>): ExecutionSummary {
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

async function handleHttpResponse(response: Response): Promise<ExecutionSummary> {
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
  return projectExecutionSummary(parsedSuccess.data.data);
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

  let response: Response;
  try {
    response = await (options.fetchImplementation ?? globalThis.fetch)(EXECUTIONS_ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (options.signal?.aborted === true || isAbortError(error)) {
      throw new ExecutionClientError('A solicitação de execução foi cancelada.', {
        code: 'REQUEST_ABORTED',
        cause: error,
      });
    }
    throw new ExecutionClientError('Não foi possível conectar ao serviço de execução.', {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }

  return handleHttpResponse(response);
}

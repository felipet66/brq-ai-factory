import { z } from 'zod';

const executionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/u);
const technicalResumeCheckpointStatusSchema = z.enum([
  'AVAILABLE',
  'NOT_FOUND',
  'CLEANUP_PENDING',
  'CLEANUP_FAILED',
]);
const technicalResumeEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        attemptId: z
          .string()
          .regex(
            /^technical-resume-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
          ),
        sourceExecutionId: executionIdSchema,
        checkpointHash: z.string().regex(/^[a-f0-9]{64}$/u),
        status: z.enum(['COMPLETION_PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']),
        resultHash: z.string().regex(/^[a-f0-9]{64}$/u),
        usesOpenAI: z.literal(false),
      })
      .strict(),
    metadata: z.object({ requestId: z.string(), apiVersion: z.string() }).passthrough(),
    errors: z.tuple([]),
  })
  .strict();

const latestTechnicalResumeEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        sourceExecutionId: executionIdSchema,
        checkpointStatus: technicalResumeCheckpointStatusSchema,
        attempt: z
          .object({
            attemptId: z.string().min(1).max(128),
            checkpointHash: z.string().regex(/^[a-f0-9]{64}$/u),
            status: z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']),
            activePhase: z
              .enum(['EXECUTING', 'COMPLETION_PENDING', 'RECOVERY_REQUIRED'])
              .nullable(),
            startedAt: z.string().datetime({ offset: true }),
            finishedAt: z.string().datetime({ offset: true }).nullable(),
            resultHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/u)
              .nullable(),
            reasonCode: z
              .string()
              .regex(/^[A-Z][A-Z0-9_]{1,127}$/u)
              .nullable(),
            cleanupConfirmed: z.boolean(),
            usesOpenAI: z.literal(false),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    metadata: z.object({ requestId: z.string(), apiVersion: z.string() }).passthrough(),
    errors: z.tuple([]),
  })
  .strict();

const technicalResumeErrorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    errors: z
      .array(z.object({ code: z.string().min(1), message: z.string().min(1) }).passthrough())
      .min(1),
  })
  .passthrough();

export type ExecutionTechnicalResumeResult = Readonly<
  z.infer<typeof technicalResumeEnvelopeSchema>['data']
>;
export type LatestExecutionTechnicalResumeAttempt = Readonly<
  NonNullable<z.infer<typeof latestTechnicalResumeEnvelopeSchema>['data']['attempt']>
>;
export type ExecutionTechnicalResumeState = Readonly<
  z.infer<typeof latestTechnicalResumeEnvelopeSchema>['data']
>;

export class ExecutionTechnicalResumeClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ExecutionTechnicalResumeClientError';
  }
}

type FetchImplementation = typeof fetch;

export async function resumeExecutionTechnicalPipeline(
  sourceExecutionId: string,
  options: {
    readonly fetchImplementation?: FetchImplementation;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ExecutionTechnicalResumeResult> {
  if (!executionIdSchema.safeParse(sourceExecutionId).success) {
    throw new ExecutionTechnicalResumeClientError(
      'The source execution identifier is invalid.',
      'INVALID_REQUEST',
    );
  }
  const request = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await request(
      `/api/executions/${encodeURIComponent(sourceExecutionId)}/technical-resume`,
      {
        method: 'POST',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume service is unavailable.',
      'EXECUTION_DISPATCHER_UNAVAILABLE',
      { cause: error },
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume response is invalid.',
      'INVALID_RESPONSE',
      { cause: error },
    );
  }
  if (!response.ok) {
    const parsed = technicalResumeErrorEnvelopeSchema.safeParse(payload);
    throw new ExecutionTechnicalResumeClientError(
      parsed.success ? parsed.data.errors[0]!.message : 'The technical resume was not accepted.',
      parsed.success ? parsed.data.errors[0]!.code : 'INVALID_RESPONSE',
    );
  }
  const parsed = technicalResumeEnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.sourceExecutionId !== sourceExecutionId) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume response is invalid.',
      'INVALID_RESPONSE',
      { cause: parsed.success ? undefined : parsed.error },
    );
  }
  return Object.freeze(parsed.data.data);
}

export async function getExecutionTechnicalResumeState(
  sourceExecutionId: string,
  options: {
    readonly fetchImplementation?: FetchImplementation;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ExecutionTechnicalResumeState> {
  if (!executionIdSchema.safeParse(sourceExecutionId).success) {
    throw new ExecutionTechnicalResumeClientError(
      'The source execution identifier is invalid.',
      'INVALID_REQUEST',
    );
  }
  const request = options.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await request(
      `/api/executions/${encodeURIComponent(sourceExecutionId)}/technical-resume`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch (error) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume history is unavailable.',
      'EXECUTION_DISPATCHER_UNAVAILABLE',
      { cause: error },
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume history response is invalid.',
      'INVALID_RESPONSE',
      { cause: error },
    );
  }
  if (!response.ok) {
    const parsedError = technicalResumeErrorEnvelopeSchema.safeParse(payload);
    throw new ExecutionTechnicalResumeClientError(
      parsedError.success
        ? parsedError.data.errors[0]!.message
        : 'The technical resume history was not accepted.',
      parsedError.success ? parsedError.data.errors[0]!.code : 'INVALID_RESPONSE',
    );
  }
  const parsed = latestTechnicalResumeEnvelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.data.sourceExecutionId !== sourceExecutionId) {
    throw new ExecutionTechnicalResumeClientError(
      'The technical resume history response is invalid.',
      'INVALID_RESPONSE',
      { cause: parsed.success ? undefined : parsed.error },
    );
  }
  return Object.freeze({
    ...parsed.data.data,
    attempt: parsed.data.data.attempt === null ? null : Object.freeze(parsed.data.data.attempt),
  });
}

export async function getLatestExecutionTechnicalResumeAttempt(
  sourceExecutionId: string,
  options: {
    readonly fetchImplementation?: FetchImplementation;
    readonly signal?: AbortSignal;
  } = {},
): Promise<LatestExecutionTechnicalResumeAttempt | null> {
  return (await getExecutionTechnicalResumeState(sourceExecutionId, options)).attempt;
}

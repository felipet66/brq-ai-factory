import { z } from 'zod';

const executionIdSchema = z.string().regex(/^execution-[a-f0-9]{32}$/);
const jobIdSchema = z.string().regex(/^job-[a-f0-9]{32}$/);

const rerunAcceptedSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        sourceExecutionId: executionIdSchema,
        executionId: executionIdSchema,
        jobId: jobIdSchema,
        status: z.literal('QUEUED'),
        replayMode: z.literal('REQUIRE_CACHE_HIT'),
        usesOpenAI: z.literal(false),
      })
      .strict(),
    metadata: z
      .object({
        requestId: z.string().min(1),
        apiVersion: z.string().min(1),
        executionId: executionIdSchema,
      })
      .strict(),
    errors: z.tuple([]),
  })
  .strict();

const rerunErrorSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: z.object({ requestId: z.string().min(1) }).passthrough(),
    errors: z
      .array(
        z.object({ code: z.string().min(1), message: z.string().min(1).max(300) }).passthrough(),
      )
      .min(1),
  })
  .passthrough();

export type ExecutionRerunAccepted = Readonly<z.infer<typeof rerunAcceptedSchema>['data']>;
type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ExecutionRerunClientError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(message: string, options: { readonly code: string; readonly status?: number }) {
    super(message);
    this.name = 'ExecutionRerunClientError';
    this.code = options.code;
    this.status = options.status ?? null;
  }
}

export async function rerunExecutionCacheOnly(
  sourceExecutionId: string,
  options: {
    readonly fetchImplementation?: FetchImplementation;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ExecutionRerunAccepted> {
  if (!executionIdSchema.safeParse(sourceExecutionId).success) {
    throw new ExecutionRerunClientError('The source execution identifier is invalid.', {
      code: 'INVALID_EXECUTION_ID',
    });
  }

  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImplementation(
      `/api/executions/${encodeURIComponent(sourceExecutionId)}/rerun`,
      {
        method: 'POST',
        cache: 'no-store',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch {
    throw new ExecutionRerunClientError('The cache-only rerun service is unavailable.', {
      code: 'NETWORK_ERROR',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ExecutionRerunClientError('The cache-only rerun response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }

  if (!response.ok) {
    const parsed = rerunErrorSchema.safeParse(payload);
    throw new ExecutionRerunClientError(
      parsed.success ? parsed.data.errors[0]!.message : 'The cache-only rerun was not accepted.',
      {
        code: parsed.success ? parsed.data.errors[0]!.code : 'API_ERROR',
        status: response.status,
      },
    );
  }

  const parsed = rerunAcceptedSchema.safeParse(payload);
  if (
    !parsed.success ||
    response.status !== 202 ||
    parsed.data.data.sourceExecutionId !== sourceExecutionId ||
    parsed.data.metadata.executionId !== parsed.data.data.executionId
  ) {
    throw new ExecutionRerunClientError('The cache-only rerun response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return Object.freeze({ ...parsed.data.data });
}

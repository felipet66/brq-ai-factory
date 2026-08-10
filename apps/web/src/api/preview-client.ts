import { z } from 'zod';

import {
  executionPreviewControlSchema,
  previewSessionViewSchema,
  previewStartInputSchema,
  type ExecutionPreviewControl,
  type PreviewSessionView,
  type PreviewStartInput,
} from './preview-contracts';

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const metadataSchema = z
  .object({
    requestId: z.string().regex(/^request-[0-9a-f-]{36}$/u),
    apiVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
    executionId: z
      .string()
      .regex(/^execution-[a-f0-9]{32}$/u)
      .optional(),
  })
  .strict();
const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    data: z.null(),
    metadata: metadataSchema,
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
const controlEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: executionPreviewControlSchema,
    metadata: metadataSchema,
    errors: z.tuple([]),
  })
  .strict();
const sessionEnvelopeSchema = z
  .object({
    success: z.literal(true),
    data: previewSessionViewSchema,
    metadata: metadataSchema,
    errors: z.tuple([]),
  })
  .strict();

export interface PreviewClientOptions {
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: FetchImplementation;
}

export class PreviewClientError extends Error {
  readonly code:
    'INVALID_INPUT' | 'REQUEST_ABORTED' | 'NETWORK_ERROR' | 'API_ERROR' | 'INVALID_RESPONSE';
  readonly status: number | null;

  constructor(
    message: string,
    options: {
      readonly code: PreviewClientError['code'];
      readonly status?: number;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'PreviewClientError';
    this.code = options.code;
    this.status = options.status ?? null;
  }
}

function fetcher(options: PreviewClientOptions): FetchImplementation {
  return options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
}

function transportError(error: unknown, signal?: AbortSignal): PreviewClientError {
  if (signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')) {
    return new PreviewClientError('A solicitação de Preview foi cancelada.', {
      code: 'REQUEST_ABORTED',
      cause: error,
    });
  }
  return new PreviewClientError('Não foi possível conectar ao serviço de Preview.', {
    code: 'NETWORK_ERROR',
    cause: error,
  });
}

async function readJson(response: Response): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    throw new PreviewClientError('A resposta do serviço de Preview é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new PreviewClientError('A resposta do serviço de Preview é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: error,
    });
  }
}

async function request<Value>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<Value>,
  options: PreviewClientOptions,
): Promise<Value> {
  let response: Response;
  try {
    response = await fetcher(options)(path, {
      ...init,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    throw transportError(error, options.signal);
  }
  const payload = await readJson(response);
  if (!response.ok) {
    const parsed = errorEnvelopeSchema.safeParse(payload);
    throw new PreviewClientError(
      parsed.success ? parsed.data.errors[0]!.message : 'O Preview não pôde ser concluído.',
      { code: 'API_ERROR', status: response.status },
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PreviewClientError('A resposta do serviço de Preview é inválida.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function getExecutionPreview(
  executionId: string,
  options: PreviewClientOptions = {},
): Promise<ExecutionPreviewControl> {
  const envelope = await request(
    `/api/executions/${encodeURIComponent(executionId)}/preview`,
    { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' },
    controlEnvelopeSchema,
    options,
  );
  return Object.freeze(envelope.data);
}

export async function startExecutionPreview(
  executionId: string,
  input: PreviewStartInput = {},
  options: PreviewClientOptions = {},
): Promise<PreviewSessionView> {
  const parsed = previewStartInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PreviewClientError('A configuração do Preview é inválida.', {
      code: 'INVALID_INPUT',
      cause: parsed.error,
    });
  }
  const envelope = await request(
    `/api/executions/${encodeURIComponent(executionId)}/preview`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    },
    sessionEnvelopeSchema,
    options,
  );
  return Object.freeze(envelope.data);
}

export async function getPreviewSession(
  previewId: string,
  options: PreviewClientOptions = {},
): Promise<PreviewSessionView> {
  const envelope = await request(
    `/api/previews/${encodeURIComponent(previewId)}`,
    { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' },
    sessionEnvelopeSchema,
    options,
  );
  return Object.freeze(envelope.data);
}

export async function stopPreviewSession(
  previewId: string,
  options: PreviewClientOptions = {},
): Promise<PreviewSessionView> {
  const envelope = await request(
    `/api/previews/${encodeURIComponent(previewId)}`,
    { method: 'DELETE', headers: { accept: 'application/json' } },
    sessionEnvelopeSchema,
    options,
  );
  return Object.freeze(envelope.data);
}

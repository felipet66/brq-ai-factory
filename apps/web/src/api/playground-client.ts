import { z } from 'zod';

import {
  playgroundCatalogSchema,
  playgroundErrorEnvelopeSchema,
  playgroundPreviewRequestSchema,
  playgroundPreviewSchema,
  playgroundSuccessEnvelopeSchema,
  playgroundValidationRequestSchema,
  playgroundValidationSchema,
  type PlaygroundCatalog,
  type PlaygroundPreview,
  type PlaygroundPreviewRequest,
  type PlaygroundValidation,
  type PlaygroundValidationRequest,
} from './playground-contracts';

const AGENTS_ENDPOINT = '/api/playground/agents';
const PREVIEW_ENDPOINT = '/api/playground/preview';
const VALIDATE_ENDPOINT = '/api/playground/validate';

const catalogEnvelopeSchema = playgroundSuccessEnvelopeSchema(playgroundCatalogSchema);
const previewEnvelopeSchema = playgroundSuccessEnvelopeSchema(playgroundPreviewSchema);
const validationEnvelopeSchema = playgroundSuccessEnvelopeSchema(playgroundValidationSchema);

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PlaygroundClientOptions {
  readonly signal?: AbortSignal;
  readonly fetchImplementation?: FetchImplementation;
}

export type PlaygroundClientErrorCode =
  'INVALID_INPUT' | 'REQUEST_ABORTED' | 'NETWORK_ERROR' | 'API_ERROR' | 'INVALID_RESPONSE';

interface PlaygroundClientErrorOptions {
  readonly code: PlaygroundClientErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly path?: string;
  readonly cause?: unknown;
}

export class PlaygroundClientError extends Error {
  readonly code: PlaygroundClientErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly path: string | null;

  constructor(message: string, options: PlaygroundClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'PlaygroundClientError';
    this.code = options.code;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.path = options.path ?? null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function request(
  endpoint: string,
  init: RequestInit,
  options: PlaygroundClientOptions,
): Promise<Response> {
  if (isSignalAborted(options.signal)) {
    throw new PlaygroundClientError('The Playground request was cancelled.', {
      code: 'REQUEST_ABORTED',
    });
  }

  try {
    return await (options.fetchImplementation ?? globalThis.fetch)(endpoint, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (isSignalAborted(options.signal) || isAbortError(error)) {
      throw new PlaygroundClientError('The Playground request was cancelled.', {
        code: 'REQUEST_ABORTED',
        cause: error,
      });
    }
    throw new PlaygroundClientError('The Playground service is unavailable.', {
      code: 'NETWORK_ERROR',
      cause: error,
    });
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new PlaygroundClientError('The Playground response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  try {
    return await response.json();
  } catch (error) {
    throw new PlaygroundClientError('The Playground response is invalid.', {
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
    const parsedError = playgroundErrorEnvelopeSchema.safeParse(payload);
    if (!parsedError.success) {
      throw new PlaygroundClientError('The Playground request could not be completed.', {
        code: 'API_ERROR',
        status: response.status,
      });
    }
    const issue = parsedError.data.errors[0]!;
    throw new PlaygroundClientError(issue.message, {
      code: 'API_ERROR',
      status: response.status,
      requestId: parsedError.data.metadata.requestId,
      ...(issue.path === undefined ? {} : { path: issue.path }),
    });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new PlaygroundClientError('The Playground response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function getPlaygroundAgents(
  options: PlaygroundClientOptions = {},
): Promise<PlaygroundCatalog> {
  const response = await request(
    AGENTS_ENDPOINT,
    { method: 'GET', headers: { accept: 'application/json' } },
    options,
  );
  const envelope = await parseEnvelope(response, catalogEnvelopeSchema);
  return envelope.data;
}

export async function buildPlaygroundPreview(
  rawRequest: PlaygroundPreviewRequest,
  options: PlaygroundClientOptions = {},
): Promise<PlaygroundPreview> {
  const parsedRequest = playgroundPreviewRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    throw new PlaygroundClientError('Provide a valid input for the selected agent.', {
      code: 'INVALID_INPUT',
      cause: parsedRequest.error,
    });
  }
  const response = await request(
    PREVIEW_ENDPOINT,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parsedRequest.data),
    },
    options,
  );
  const envelope = await parseEnvelope(response, previewEnvelopeSchema);
  if (envelope.data.agent !== parsedRequest.data.agent) {
    throw new PlaygroundClientError('The Playground response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return envelope.data;
}

export async function validatePlaygroundCandidate(
  rawRequest: PlaygroundValidationRequest,
  options: PlaygroundClientOptions = {},
): Promise<PlaygroundValidation> {
  const parsedRequest = playgroundValidationRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    throw new PlaygroundClientError('Provide a valid candidate and agent input.', {
      code: 'INVALID_INPUT',
      cause: parsedRequest.error,
    });
  }
  const response = await request(
    VALIDATE_ENDPOINT,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(parsedRequest.data),
    },
    options,
  );
  const envelope = await parseEnvelope(response, validationEnvelopeSchema);
  if (envelope.data.agent !== parsedRequest.data.agent) {
    throw new PlaygroundClientError('The Playground response is invalid.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
  return envelope.data;
}

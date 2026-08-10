import { API_ERROR_CODES, MAX_EXECUTION_PAYLOAD_BYTES } from './constants';
import type { ExecutionListQueryHttp } from './contracts';
import { HttpApiError } from './errors';
import { executionListQueryHttpSchema } from './schemas';

export function createRequestId(): string {
  return `request-${crypto.randomUUID()}`;
}

function requireJsonContentType(request: Request): void {
  const header = request.headers.get('content-type');
  const mediaType = header?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new HttpApiError('Content-Type application/json é obrigatório.', {
      code: API_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      status: 415,
    });
  }
}

function requireIdentityEncoding(request: Request): void {
  const encoding = request.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== '' && encoding !== 'identity') {
    throw new HttpApiError('Content-Encoding não é suportado.', {
      code: API_ERROR_CODES.UNSUPPORTED_CONTENT_ENCODING,
      status: 415,
    });
  }
}

function assertContentLength(request: Request, maxBytes: number): void {
  const value = request.headers.get('content-length');
  if (value === null) return;
  if (!/^\d+$/.test(value)) {
    throw new HttpApiError('Content-Length inválido.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'headers.content-length',
    });
  }
  if (Number(value) > maxBytes) {
    throw new HttpApiError('O payload excede o limite permitido.', {
      code: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
      status: 413,
    });
  }
}

async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpApiError('O payload excede o limite permitido.', {
        code: API_ERROR_CODES.PAYLOAD_TOO_LARGE,
        status: 413,
      });
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  requireJsonContentType(request);
  requireIdentityEncoding(request);
  assertContentLength(request, maxBytes);

  const bytes = await readBytes(request, maxBytes);
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new HttpApiError('O payload deve utilizar UTF-8 válido.', {
      code: API_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      status: 415,
      cause: error,
    });
  }

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new HttpApiError('O corpo JSON é inválido.', {
      code: API_ERROR_CODES.INVALID_JSON,
      status: 400,
      cause: error,
    });
  }
}

export async function readExecutionJson(
  request: Request,
  maxBytes = MAX_EXECUTION_PAYLOAD_BYTES,
): Promise<unknown> {
  return readJsonBody(request, maxBytes);
}

export function rejectQueryParameters(request: Request): void {
  if (new URL(request.url).searchParams.size > 0) {
    throw new HttpApiError('Parâmetros de query não são aceitos.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'query',
    });
  }
}

export function rejectRequestBody(request: Request): void {
  const contentLength = request.headers.get('content-length');
  if (request.body !== null || (contentLength !== null && contentLength !== '0')) {
    throw new HttpApiError('O método GET não aceita corpo.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'body',
    });
  }
}

/**
 * Accepts a genuinely empty body even when the Next.js Node adapter represents an HTTP POST with
 * `Content-Length: 0` as an empty ReadableStream. Any observed byte still fails closed.
 */
export async function requireEmptyRequestBody(request: Request): Promise<void> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/u.test(contentLength) || contentLength !== '0')) {
    throw new HttpApiError('A requisição não aceita corpo.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: 'body',
    });
  }
  if (request.body === null) return;

  const reader = request.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength > 0) {
        await reader.cancel().catch(() => undefined);
        throw new HttpApiError('A requisição não aceita corpo.', {
          code: API_ERROR_CODES.INVALID_REQUEST,
          status: 400,
          path: 'body',
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function readExecutionListQuery(request: Request): ExecutionListQueryHttp {
  const search = new URL(request.url).searchParams;
  const query: Record<string, string> = {};
  const knownKeys = new Set([
    'status',
    'readiness',
    'createdAfter',
    'createdBefore',
    'limit',
    'cursor',
  ]);

  for (const key of new Set(search.keys())) {
    if (!knownKeys.has(key) || search.getAll(key).length !== 1) {
      throw new HttpApiError('Os parâmetros de consulta são inválidos.', {
        code: API_ERROR_CODES.INVALID_REQUEST,
        status: 400,
        path: `query.${key}`,
      });
    }
    query[key] = search.get(key)!;
  }

  const parsed = executionListQueryHttpSchema.safeParse(query);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.map(String).join('.') || 'query';
    throw new HttpApiError('Os parâmetros de consulta são inválidos.', {
      code: API_ERROR_CODES.INVALID_REQUEST,
      status: 400,
      path: path === 'query' ? path : `query.${path}`,
    });
  }
  return parsed.data;
}

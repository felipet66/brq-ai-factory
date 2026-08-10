import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { DockerCommandExecutor, DockerCommandResult } from './docker-cli';
import { buildRelayArguments } from './command-builder';
import { PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER } from '../contracts';

const MAX_REQUEST_PATH_BYTES = 4 * 1024;
const RELAY_ENVELOPE_OVERHEAD_BYTES = 16 * 1024;
const SAFE_STATUS_CODES = new Set([200, 400, 404, 405]);
const SAFE_CONTENT_TYPES = new Set([
  'application/json; charset=utf-8',
  'image/svg+xml; charset=utf-8',
  'text/css; charset=utf-8',
  'text/html; charset=utf-8',
  'text/javascript; charset=utf-8',
  'text/plain; charset=utf-8',
  'text/xml; charset=utf-8',
]);
const HASH = /^[a-f0-9]{64}$/u;

export interface PreviewLoopbackRelay {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly accessToken: string;
  close(): Promise<boolean>;
}

export interface CreatePreviewLoopbackRelayInput {
  readonly executor: DockerCommandExecutor;
  readonly containerId: string;
  readonly responseBytes: number;
  readonly responseTimeoutMs: number;
}

export type PreviewLoopbackRelayFactory = (
  input: CreatePreviewLoopbackRelayInput,
) => Promise<PreviewLoopbackRelay>;

interface RelayEnvelope {
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: Buffer;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sendFailure(response: ServerResponse, statusCode: 400 | 405 | 502): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body = statusCode === 405 ? 'Method Not Allowed\n' : 'Preview Unavailable\n';
  response.writeHead(statusCode, {
    'Cache-Control': 'private, no-store',
    Connection: 'close',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    ...(statusCode === 405 ? { Allow: 'GET, HEAD' } : {}),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function safePath(request: IncomingMessage): string | null {
  const value = request.url;
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    Buffer.byteLength(value, 'utf8') > MAX_REQUEST_PATH_BYTES ||
    /[\u0000-\u001F\u007F\\]/u.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value, 'http://preview.invalid');
    return parsed.origin === 'http://preview.invalid' ? `${parsed.pathname}${parsed.search}` : null;
  } catch {
    return null;
  }
}

function successfulCommand(result: DockerCommandResult): boolean {
  return (
    result.exitCode === 0 &&
    !result.timedOut &&
    !result.cancelled &&
    !result.outputLimitExceeded &&
    result.sourceCode === null
  );
}

function parseRelayEnvelope(result: DockerCommandResult, responseBytes: number): RelayEnvelope {
  if (!successfulCommand(result)) throw new Error('RELAY_COMMAND_FAILED');
  const value: unknown = JSON.parse(result.stdout);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('RELAY_ENVELOPE_INVALID');
  }
  const document = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(document).sort()) !==
      JSON.stringify(
        ['abiVersion', 'body', 'byteLength', 'contentHash', 'contentType', 'statusCode'].sort(),
      ) ||
    document.abiVersion !== '1.0.0' ||
    typeof document.statusCode !== 'number' ||
    !SAFE_STATUS_CODES.has(document.statusCode) ||
    typeof document.contentType !== 'string' ||
    !SAFE_CONTENT_TYPES.has(document.contentType) ||
    typeof document.byteLength !== 'number' ||
    !Number.isInteger(document.byteLength) ||
    document.byteLength < 0 ||
    document.byteLength > responseBytes ||
    typeof document.contentHash !== 'string' ||
    !HASH.test(document.contentHash) ||
    typeof document.body !== 'string'
  ) {
    throw new Error('RELAY_ENVELOPE_INVALID');
  }
  const body = Buffer.from(document.body, 'base64');
  if (
    body.toString('base64') !== document.body ||
    body.byteLength !== document.byteLength ||
    sha256(body) !== document.contentHash
  ) {
    throw new Error('RELAY_ENVELOPE_INTEGRITY');
  }
  return Object.freeze({
    statusCode: document.statusCode,
    contentType: document.contentType,
    body,
  });
}

async function relayRequest(
  input: CreatePreviewLoopbackRelayInput,
  accessToken: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const provided = request.headers[PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER];
  const expectedBytes = Buffer.from(accessToken, 'utf8');
  const providedBytes =
    typeof provided === 'string' ? Buffer.from(provided, 'utf8') : Buffer.alloc(0);
  if (
    providedBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    sendFailure(response, 400);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendFailure(response, 405);
    return;
  }
  if (
    request.headers['transfer-encoding'] !== undefined ||
    (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')
  ) {
    sendFailure(response, 400);
    return;
  }
  const path = safePath(request);
  if (path === null) {
    sendFailure(response, 400);
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', () => {
    if (!response.writableEnded) abort();
  });
  try {
    const payload = Buffer.from(`${JSON.stringify({ method: request.method, path })}\n`, 'utf8');
    const result = await input.executor.execute({
      args: buildRelayArguments(input.containerId),
      input: payload,
      timeoutMs: input.responseTimeoutMs,
      outputLimitBytes: Math.ceil((input.responseBytes * 4) / 3) + RELAY_ENVELOPE_OVERHEAD_BYTES,
      signal: controller.signal,
    });
    const envelope = parseRelayEnvelope(result, input.responseBytes);
    response.writeHead(envelope.statusCode, {
      'Cache-Control': 'private, no-store',
      Connection: 'close',
      'Content-Length': request.method === 'HEAD' ? 0 : envelope.body.byteLength,
      'Content-Type': envelope.contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : envelope.body);
  } catch {
    sendFailure(response, 502);
  } finally {
    request.removeListener('aborted', abort);
  }
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const address = server.address();
      if (
        address === null ||
        typeof address === 'string' ||
        address.address !== '127.0.0.1' ||
        !Number.isInteger(address.port) ||
        address.port < 1 ||
        address.port > 65_535
      ) {
        reject(new Error('RELAY_BIND_UNSAFE'));
        return;
      }
      resolve(address.port);
    });
  });
}

export const createNodePreviewLoopbackRelay: PreviewLoopbackRelayFactory = async (input) => {
  const accessToken = randomBytes(32).toString('base64url');
  const server = createServer((request, response) => {
    void relayRequest(input, accessToken, request, response);
  });
  server.maxConnections = 16;
  server.requestTimeout = input.responseTimeoutMs;
  server.headersTimeout = input.responseTimeoutMs;
  server.keepAliveTimeout = 1;
  server.maxRequestsPerSocket = 1;
  const port = await listenOnLoopback(server);
  let closePromise: Promise<boolean> | undefined;
  return Object.freeze({
    host: '127.0.0.1' as const,
    port,
    accessToken,
    close() {
      closePromise ??= new Promise<boolean>((resolve) => {
        server.closeAllConnections();
        server.close((error) => resolve(error === undefined));
      });
      return closePromise;
    },
  });
};

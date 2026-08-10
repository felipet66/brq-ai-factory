import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  HEALTH_BODY,
  HEALTH_PATH,
  INTERNAL_PORT,
  MEDIA_TYPES,
  SITE_ROOT,
  assertCondition,
  containedPath,
  inspectSafePath,
  runHelper,
  sha256,
  verifyPreparedSite,
} from './common.mjs';

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

function safeRequestPath(rawUrl) {
  assertCondition(
    typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//'),
    'REQUEST_PATH',
  );
  const url = new URL(rawUrl, 'http://preview.invalid');
  assertCondition(url.origin === 'http://preview.invalid', 'REQUEST_PATH');
  assertCondition(!/%(?:00|2f|5c|25)/iu.test(url.pathname), 'REQUEST_PATH');
  const decoded = decodeURIComponent(url.pathname);
  assertCondition(!decoded.includes('\\') && !decoded.includes('\u0000'), 'REQUEST_PATH');
  const segments = decoded.split('/').filter(Boolean);
  assertCondition(!segments.includes('.') && !segments.includes('..'), 'REQUEST_PATH');
  const relativePath =
    segments.length === 0 || decoded.endsWith('/')
      ? `${segments.join('/')}${segments.length === 0 ? '' : '/'}index.html`
      : segments.join('/');
  return inspectSafePath(relativePath);
}

function respond(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

await runHelper('SERVE', async () => {
  assertCondition(process.argv.length === 2, 'INVALID_ARGUMENTS');
  const ttlSeconds = Number(process.env.BRQ_PREVIEW_TTL_SECONDS);
  assertCondition(Number.isInteger(ttlSeconds) && ttlSeconds >= 60 && ttlSeconds <= 900, 'TTL');
  const manifest = await verifyPreparedSite();
  const files = new Map(manifest.files.map((file) => [file.path, file]));
  let closing = false;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        respond(response, 405, 'Method Not Allowed\n', {
          Allow: 'GET, HEAD',
          'Content-Type': 'text/plain; charset=utf-8',
        });
        return;
      }
      if (request.url === HEALTH_PATH) {
        respond(response, 200, request.method === 'HEAD' ? '' : HEALTH_BODY, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        return;
      }
      const requestPath = safeRequestPath(request.url);
      const expected = files.get(requestPath);
      if (expected === undefined) {
        respond(response, 404, 'Not Found\n', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }
      const target = containedPath(SITE_ROOT, requestPath);
      const metadata = await lstat(target);
      assertCondition(metadata.isFile() && !metadata.isSymbolicLink(), 'FILE_TYPE');
      assertCondition((await realpath(target)) === target, 'FILE_ALIAS');
      const content = await readFile(target);
      assertCondition(content.byteLength === expected.byteLength, 'FILE_BYTES');
      assertCondition(sha256(content) === expected.contentHash, 'FILE_HASH');
      const contentType = MEDIA_TYPES[path.posix.extname(requestPath).toLowerCase()];
      assertCondition(typeof contentType === 'string', 'MEDIA_TYPE');
      response.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Length': content.byteLength,
        'Content-Type': contentType,
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      if (!response.headersSent) {
        respond(response, 400, 'Bad Request\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      } else {
        response.destroy();
      }
    }
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;

  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  setTimeout(close, ttlSeconds * 1000).unref();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(INTERNAL_PORT, '127.0.0.1', resolve);
  });
});

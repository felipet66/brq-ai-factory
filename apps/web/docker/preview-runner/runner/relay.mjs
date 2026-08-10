import { request } from 'node:http';

import {
  INTERNAL_PORT,
  assertCondition,
  assertExactKeys,
  readStdin,
  runHelper,
  sha256,
} from './common.mjs';

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_PATH_BYTES = 4 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const ALLOWED_STATUS_CODES = new Set([200, 400, 404, 405]);
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json; charset=utf-8',
  'image/svg+xml; charset=utf-8',
  'text/css; charset=utf-8',
  'text/html; charset=utf-8',
  'text/javascript; charset=utf-8',
  'text/plain; charset=utf-8',
  'text/xml; charset=utf-8',
]);

function validateRequest(value) {
  assertExactKeys(value, ['method', 'path'], 'REQUEST');
  assertCondition(value.method === 'GET' || value.method === 'HEAD', 'METHOD');
  assertCondition(
    typeof value.path === 'string' &&
      value.path.startsWith('/') &&
      !value.path.startsWith('//') &&
      Buffer.byteLength(value.path, 'utf8') <= MAX_PATH_BYTES &&
      !/[\u0000-\u001F\u007F\\]/u.test(value.path),
    'PATH',
  );
  const parsed = new URL(value.path, 'http://preview.invalid');
  assertCondition(parsed.origin === 'http://preview.invalid', 'PATH');
  return Object.freeze({ method: value.method, path: `${parsed.pathname}${parsed.search}` });
}

function requestLocalServer(input) {
  return new Promise((resolve, reject) => {
    const client = request(
      {
        host: '127.0.0.1',
        port: INTERNAL_PORT,
        path: input.path,
        method: input.method,
        timeout: 5_000,
        headers: { Connection: 'close', Host: 'preview.invalid' },
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;
        response.on('data', (chunk) => {
          totalBytes += chunk.byteLength;
          if (totalBytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
          else response.destroy(new Error('RESPONSE_LIMIT'));
        });
        response.once('end', () => {
          try {
            const statusCode = response.statusCode;
            const contentType = response.headers['content-type'];
            assertCondition(
              typeof statusCode === 'number' && ALLOWED_STATUS_CODES.has(statusCode),
              'STATUS',
            );
            assertCondition(
              typeof contentType === 'string' && ALLOWED_CONTENT_TYPES.has(contentType),
              'CONTENT_TYPE',
            );
            const body = Buffer.concat(chunks);
            assertCondition(body.byteLength === totalBytes, 'RESPONSE_LIMIT');
            resolve(
              Object.freeze({
                abiVersion: '1.0.0',
                statusCode,
                contentType,
                byteLength: body.byteLength,
                contentHash: sha256(body),
                body: body.toString('base64'),
              }),
            );
          } catch (error) {
            reject(error);
          }
        });
        response.once('error', reject);
      },
    );
    client.once('timeout', () => client.destroy(new Error('RESPONSE_TIMEOUT')));
    client.once('error', reject);
    client.end();
  });
}

await runHelper('RELAY', async () => {
  assertCondition(process.argv.length === 2, 'INVALID_ARGUMENTS');
  const relayRequest = validateRequest(JSON.parse(await readStdin(MAX_REQUEST_BYTES)));
  const response = await requestLocalServer(relayRequest);
  process.stdout.write(`${JSON.stringify(response)}\n`);
});

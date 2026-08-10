import { request } from 'node:http';

import { PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER } from '../contracts';

export interface PreviewHealthProbeRequest {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly path: string;
  readonly expectedBody: string;
  readonly timeoutMs: number;
  readonly accessToken: string;
  readonly signal?: AbortSignal;
}

export interface PreviewHealthProbe {
  check(request: PreviewHealthProbeRequest): Promise<boolean>;
}

export function createNodePreviewHealthProbe(): PreviewHealthProbe {
  return Object.freeze({
    check: async (input: PreviewHealthProbeRequest) =>
      new Promise<boolean>((resolve) => {
        const client = request(
          {
            host: input.host,
            port: input.port,
            path: input.path,
            method: 'GET',
            timeout: input.timeoutMs,
            signal: input.signal,
            headers: Object.freeze({
              Connection: 'close',
              Host: 'preview.invalid',
              [PREVIEW_RUNTIME_GATEWAY_ACCESS_HEADER]: input.accessToken,
            }),
          },
          (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on('data', (chunk: Buffer) => {
              bytes += chunk.byteLength;
              if (bytes <= 256) chunks.push(chunk);
              else response.destroy();
            });
            response.once('end', () => {
              let body = '';
              try {
                body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
              } catch {
                resolve(false);
                return;
              }
              resolve(response.statusCode === 200 && body === input.expectedBody);
            });
            response.once('error', () => resolve(false));
          },
        );
        client.once('timeout', () => {
          client.destroy();
          resolve(false);
        });
        client.once('error', () => resolve(false));
        client.end();
      }),
  });
}

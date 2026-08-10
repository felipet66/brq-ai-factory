import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  DockerCommandExecutor,
  DockerCommandRequest,
  DockerCommandResult,
} from './docker-cli';
import { createNodePreviewLoopbackRelay } from './loopback-relay';

function result(stdout: string): DockerCommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: '',
    timedOut: false,
    cancelled: false,
    outputLimitExceeded: false,
    sourceCode: null,
  };
}

function envelope(body: Buffer, overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    abiVersion: '1.0.0',
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    byteLength: body.byteLength,
    contentHash: createHash('sha256').update(body).digest('hex'),
    body: body.toString('base64'),
    ...overrides,
  })}\n`;
}

describe('Preview loopback relay', () => {
  it('binds to loopback and relays only a fixed docker exec helper request', async () => {
    const body = Buffer.from('<h1>Preview</h1>', 'utf8');
    const requests: DockerCommandRequest[] = [];
    const executor: DockerCommandExecutor = {
      async execute(request) {
        requests.push(request);
        return result(envelope(body));
      },
    };
    const relay = await createNodePreviewLoopbackRelay({
      executor,
      containerId: 'a'.repeat(64),
      responseBytes: 512 * 1024,
      responseTimeoutMs: 5_000,
    });
    try {
      const response = await fetch(
        `http://${relay.host}:${relay.port}/assets/app.html?theme=dark`,
        {
          headers: { 'x-brq-preview-runtime-token': relay.accessToken },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<h1>Preview</h1>');
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request?.args).toEqual([
        'container',
        'exec',
        '--interactive',
        '--workdir',
        '/',
        '--user',
        '65532:65532',
        '--env',
        'NODE_ENV=production',
        'a'.repeat(64),
        '/usr/local/bin/node',
        '/opt/brq/preview/relay.mjs',
      ]);
      expect(JSON.parse(request?.input?.toString('utf8') ?? '{}')).toEqual({
        method: 'GET',
        path: '/assets/app.html?theme=dark',
      });
    } finally {
      await expect(relay.close()).resolves.toBe(true);
      await expect(relay.close()).resolves.toBe(true);
    }
  });

  it('rejects methods outside GET and HEAD before Docker execution', async () => {
    let executionCount = 0;
    const relay = await createNodePreviewLoopbackRelay({
      executor: {
        async execute() {
          executionCount += 1;
          return result('');
        },
      },
      containerId: 'b'.repeat(64),
      responseBytes: 512 * 1024,
      responseTimeoutMs: 5_000,
    });
    try {
      const response = await fetch(`http://${relay.host}:${relay.port}/`, {
        method: 'POST',
        headers: { 'x-brq-preview-runtime-token': relay.accessToken },
      });
      expect(response.status).toBe(405);
      expect(executionCount).toBe(0);
    } finally {
      await relay.close();
    }
  });

  it('fails closed when the fixed helper response is tampered', async () => {
    const body = Buffer.from('tampered', 'utf8');
    const relay = await createNodePreviewLoopbackRelay({
      executor: {
        execute: async () => result(envelope(body, { contentHash: '0'.repeat(64) })),
      },
      containerId: 'c'.repeat(64),
      responseBytes: 512 * 1024,
      responseTimeoutMs: 5_000,
    });
    try {
      const response = await fetch(`http://${relay.host}:${relay.port}/`, {
        headers: { 'x-brq-preview-runtime-token': relay.accessToken },
      });
      expect(response.status).toBe(502);
      expect(await response.text()).toBe('Preview Unavailable\n');
    } finally {
      await relay.close();
    }
  });

  it('rejects a loopback caller without the private relay capability', async () => {
    let executionCount = 0;
    const relay = await createNodePreviewLoopbackRelay({
      executor: {
        async execute() {
          executionCount += 1;
          return result('');
        },
      },
      containerId: 'd'.repeat(64),
      responseBytes: 512 * 1024,
      responseTimeoutMs: 5_000,
    });
    try {
      const response = await fetch(`http://${relay.host}:${relay.port}/`);
      expect(response.status).toBe(400);
      expect(executionCount).toBe(0);
    } finally {
      await relay.close();
    }
  });
});

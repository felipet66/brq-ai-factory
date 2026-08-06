// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { readExecutionJson } from './request';

describe('bounded JSON reader', () => {
  it('accepts JSON content types with charset and identity encoding', async () => {
    const request = new Request('http://localhost/api/executions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'identity',
      },
      body: '{"ok":true}',
    });
    await expect(readExecutionJson(request)).resolves.toEqual({ ok: true });
  });

  it('rejects invalid Content-Length and invalid UTF-8', async () => {
    const length = new Request('http://localhost/api/executions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '-1' },
      body: '{}',
    });
    const utf8 = new Request('http://localhost/api/executions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Uint8Array.from([0xff]),
    });

    await expect(readExecutionJson(length)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    });
    await expect(readExecutionJson(utf8)).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      status: 415,
    });
  });
});

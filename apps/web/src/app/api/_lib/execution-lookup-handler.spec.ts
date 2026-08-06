// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { EXECUTION_ID, FIXED_REQUEST_ID, capturedLogger } from '@/test/api-fixtures';

import { createExecutionLookupHandler } from './execution-lookup-handler';

describe('execution lookup HTTP adapter', () => {
  const handler = createExecutionLookupHandler({
    requestIdFactory: () => FIXED_REQUEST_ID,
    logger: capturedLogger().logger,
  });

  it('keeps the future lookup contract explicit with 501', async () => {
    const response = await handler(new Request(`http://localhost/api/executions/${EXECUTION_ID}`), {
      params: Promise.resolve({ id: EXECUTION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body.errors[0].code).toBe('EXECUTION_LOOKUP_NOT_SUPPORTED');
    expect(body.metadata.executionId).toBe(EXECUTION_ID);
  });

  it('rejects malformed identifiers, query parameters and methods', async () => {
    const invalid = await handler(new Request('http://localhost/api/executions/not-an-id'), {
      params: Promise.resolve({ id: 'not-an-id' }),
    });
    const query = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}?full=true`),
      { params: Promise.resolve({ id: EXECUTION_ID }) },
    );
    const method = await handler(
      new Request(`http://localhost/api/executions/${EXECUTION_ID}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: EXECUTION_ID }) },
    );

    expect(invalid.status).toBe(400);
    expect(query.status).toBe(400);
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
  });
});

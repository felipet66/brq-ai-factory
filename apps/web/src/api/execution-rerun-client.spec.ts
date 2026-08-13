import { describe, expect, it, vi } from 'vitest';

import { rerunExecutionCacheOnly } from './execution-rerun-client';

const SOURCE_ID = `execution-${'a'.repeat(32)}`;
const EXECUTION_ID = `execution-${'b'.repeat(32)}`;
const JOB_ID = `job-${'b'.repeat(32)}`;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('execution rerun client', () => {
  it('requests an empty-body cache-only rerun and preserves its zero-OpenAI evidence', async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        {
          success: true,
          data: {
            sourceExecutionId: SOURCE_ID,
            executionId: EXECUTION_ID,
            jobId: JOB_ID,
            status: 'QUEUED',
            replayMode: 'REQUIRE_CACHE_HIT',
            usesOpenAI: false,
          },
          metadata: {
            requestId: 'request-4fbd475c-ced4-47ed-aad5-82a772ea75cd',
            apiVersion: '4.1.0',
            executionId: EXECUTION_ID,
          },
          errors: [],
        },
        202,
      ),
    );

    await expect(rerunExecutionCacheOnly(SOURCE_ID, { fetchImplementation })).resolves.toEqual({
      sourceExecutionId: SOURCE_ID,
      executionId: EXECUTION_ID,
      jobId: JOB_ID,
      status: 'QUEUED',
      replayMode: 'REQUIRE_CACHE_HIT',
      usesOpenAI: false,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(`/api/executions/${SOURCE_ID}/rerun`, {
      method: 'POST',
      cache: 'no-store',
    });
  });

  it('surfaces a cache miss as a safe regenerate-required error', async () => {
    const fetchImplementation = vi.fn(async () =>
      jsonResponse(
        {
          success: false,
          data: null,
          metadata: { requestId: 'request-test', apiVersion: '4.1.0' },
          errors: [
            {
              code: 'EXECUTION_RERUN_REGENERATE_REQUIRED',
              message: 'The replay would require a new generation and was blocked.',
            },
          ],
        },
        409,
      ),
    );

    await expect(rerunExecutionCacheOnly(SOURCE_ID, { fetchImplementation })).rejects.toMatchObject(
      {
        code: 'EXECUTION_RERUN_REGENERATE_REQUIRED',
        status: 409,
      },
    );
  });
});

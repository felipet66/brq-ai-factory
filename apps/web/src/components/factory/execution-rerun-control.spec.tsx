import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionRerunClientError, rerunExecutionCacheOnly } from '@/api/execution-rerun-client';

import { ExecutionRerunControl } from './execution-rerun-control';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/api/execution-rerun-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/execution-rerun-client')>();
  return { ...original, rerunExecutionCacheOnly: vi.fn() };
});

const rerunMock = vi.mocked(rerunExecutionCacheOnly);
const SOURCE_EXECUTION_ID = `execution-${'a'.repeat(32)}`;
const REPLAY_EXECUTION_ID = `execution-${'b'.repeat(32)}`;

beforeEach(() => {
  pushMock.mockReset();
  rerunMock.mockReset();
});

afterEach(cleanup);

describe('ExecutionRerunControl', () => {
  it('shows the cache-only action only when the execution is eligible', () => {
    const view = render(<ExecutionRerunControl executionId={SOURCE_EXECUTION_ID} eligible />);

    expect(screen.getByRole('button', { name: 'Rerun cache-only' })).toBeVisible();
    expect(screen.getByText(/cache miss stops before any paid model call/i)).toBeVisible();

    view.rerender(<ExecutionRerunControl executionId={SOURCE_EXECUTION_ID} eligible={false} />);

    expect(screen.queryByRole('button', { name: 'Rerun cache-only' })).not.toBeInTheDocument();
  });

  it('navigates to the new immutable execution after a 202 acceptance', async () => {
    rerunMock.mockResolvedValueOnce({
      sourceExecutionId: SOURCE_EXECUTION_ID,
      executionId: REPLAY_EXECUTION_ID,
      jobId: `job-${'b'.repeat(32)}`,
      status: 'QUEUED',
      replayMode: 'REQUIRE_CACHE_HIT',
      usesOpenAI: false,
    });
    render(<ExecutionRerunControl executionId={SOURCE_EXECUTION_ID} eligible />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun cache-only' }));

    expect(screen.getByRole('button', { name: 'Scheduling replay…' })).toBeDisabled();
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/executions/${REPLAY_EXECUTION_ID}/factory`),
    );
    expect(rerunMock).toHaveBeenCalledWith(SOURCE_EXECUTION_ID, {
      signal: expect.any(AbortSignal),
    });
  });

  it('submits at most once when the action is clicked twice before React rerenders', async () => {
    let resolveRerun!: (value: Awaited<ReturnType<typeof rerunExecutionCacheOnly>>) => void;
    rerunMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRerun = resolve;
        }),
    );
    render(<ExecutionRerunControl executionId={SOURCE_EXECUTION_ID} eligible />);
    const button = screen.getByRole('button', { name: 'Rerun cache-only' });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(rerunMock).toHaveBeenCalledOnce();
    resolveRerun({
      sourceExecutionId: SOURCE_EXECUTION_ID,
      executionId: REPLAY_EXECUTION_ID,
      jobId: `job-${'b'.repeat(32)}`,
      status: 'QUEUED',
      replayMode: 'REQUIRE_CACHE_HIT',
      usesOpenAI: false,
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledOnce());
  });

  it('shows the safe API message and stays put when the exact cache entry is missing', async () => {
    rerunMock.mockRejectedValueOnce(
      new ExecutionRerunClientError('The replay would require a new generation and was blocked.', {
        code: 'EXECUTION_RERUN_REGENERATE_REQUIRED',
        status: 409,
      }),
    );
    render(<ExecutionRerunControl executionId={SOURCE_EXECUTION_ID} eligible />);

    fireEvent.click(screen.getByRole('button', { name: 'Rerun cache-only' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The replay would require a new generation and was blocked.',
    );
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rerun cache-only' })).toBeEnabled();
  });
});

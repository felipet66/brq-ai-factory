import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getExecutionPreview,
  getPreviewSession,
  PreviewClientError,
  startExecutionPreview,
  stopPreviewSession,
} from '@/api/preview-client';
import type { PreviewSessionView, PreviewStatus } from '@/api/preview-contracts';

import { usePreviewSession } from './use-preview-session';

vi.mock('@/api/preview-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/preview-client')>();
  return {
    ...original,
    getExecutionPreview: vi.fn(),
    getPreviewSession: vi.fn(),
    startExecutionPreview: vi.fn(),
    stopPreviewSession: vi.fn(),
  };
});

const executionId = `execution-${'1'.repeat(32)}`;
const hash = 'a'.repeat(64);

function session(status: PreviewStatus = 'RUNNING'): PreviewSessionView {
  const isTerminal = status === 'STOPPED' || status === 'EXPIRED';
  return {
    previewId: `preview-${'2'.repeat(32)}`,
    executionId,
    status,
    health:
      status === 'RUNNING' || status === 'STOPPING'
        ? 'HEALTHY'
        : status === 'FAILED'
          ? 'UNHEALTHY'
          : isTerminal
            ? 'NOT_APPLICABLE'
            : 'PENDING',
    createdAt: '2026-08-10T00:00:00.000Z',
    startedAt: status === 'CREATED' || status === 'STARTING' ? null : '2026-08-10T00:00:01.000Z',
    expiresAt: '2026-08-10T00:10:00.000Z',
    stoppedAt: isTerminal ? '2026-08-10T00:10:00.000Z' : null,
    policy: { id: 'NODE_WEB_PREVIEW_24_V1', version: '1.0.0' },
    hashes: {
      factoryResultHash: hash,
      artifactHash: 'b'.repeat(64),
      previewRequestHash: 'c'.repeat(64),
      previewSessionHash: 'd'.repeat(64),
    },
    controlPath: `/executions/${executionId}/preview`,
    failure: status === 'FAILED' ? { code: 'PREVIEW_RUNTIME_LOST' } : null,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.mocked(getExecutionPreview).mockReset();
  vi.mocked(getPreviewSession).mockReset();
  vi.mocked(startExecutionPreview).mockReset();
  vi.mocked(stopPreviewSession).mockReset();
});
afterEach(cleanup);

describe('usePreviewSession', () => {
  it('stays disabled and performs no transport for an unapproved Factory', () => {
    const { result } = renderHook(() => usePreviewSession(executionId, false));
    expect(result.current.state).toEqual({ status: 'disabled' });
    expect(getExecutionPreview).not.toHaveBeenCalled();
  });

  it('loads eligibility without starting a Preview automatically', async () => {
    vi.mocked(getExecutionPreview).mockResolvedValue({
      eligibility: { status: 'ELIGIBLE' },
      session: null,
    });
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(startExecutionPreview).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.stop();
      await result.current.refreshSession();
    });
    expect(stopPreviewSession).not.toHaveBeenCalled();
    expect(getPreviewSession).not.toHaveBeenCalled();
  });

  it('starts and stops only through explicit callbacks', async () => {
    vi.mocked(getExecutionPreview)
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: null })
      .mockResolvedValue({ eligibility: { status: 'ELIGIBLE' }, session: session() });
    vi.mocked(startExecutionPreview).mockResolvedValue(session());
    vi.mocked(stopPreviewSession).mockResolvedValue(session('STOPPED'));
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => result.current.start());
    expect(startExecutionPreview).toHaveBeenCalledWith(executionId);
    expect(result.current.state).toMatchObject({
      status: 'ready',
      control: { session: { status: 'RUNNING' } },
    });

    await act(async () => result.current.stop());
    expect(stopPreviewSession).toHaveBeenCalledWith(`preview-${'2'.repeat(32)}`);
    expect(result.current.state).toMatchObject({
      status: 'ready',
      control: { session: { status: 'STOPPED' } },
    });
  });

  it('retains safe state and publishes sanitized action failure', async () => {
    vi.mocked(getExecutionPreview).mockResolvedValue({
      eligibility: { status: 'ELIGIBLE' },
      session: null,
    });
    vi.mocked(startExecutionPreview).mockRejectedValue(
      new PreviewClientError('Runtime unavailable.', { code: 'API_ERROR', status: 503 }),
    );
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    await act(async () => result.current.start());
    expect(result.current.state).toMatchObject({
      status: 'ready',
      action: 'NONE',
      actionError: 'Runtime unavailable.',
    });
  });

  it('keeps reconciling RUNNING sessions until expiration or runtime loss becomes observable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getExecutionPreview)
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session() })
      .mockResolvedValueOnce({
        eligibility: { status: 'ARTIFACT_UNAVAILABLE' },
        session: session('EXPIRED'),
      });
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'ready',
        control: { session: { status: 'RUNNING' } },
      }),
    );

    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'ready',
        control: { session: { status: 'EXPIRED' } },
      }),
    );
    expect(getExecutionPreview).toHaveBeenCalledTimes(2);
  });

  it('polls transient lifecycle states every 750ms and stops at a terminal state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(getExecutionPreview)
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session('CREATED') })
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session('STARTING') })
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session('STOPPING') })
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session('STOPPED') });
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: 'ready',
        control: { session: { status: 'CREATED' } },
      }),
    );

    for (const status of ['STARTING', 'STOPPING', 'STOPPED'] as const) {
      await act(async () => vi.advanceTimersByTimeAsync(750));
      await waitFor(() =>
        expect(result.current.state).toMatchObject({
          status: 'ready',
          control: { session: { status } },
        }),
      );
    }
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(getExecutionPreview).toHaveBeenCalledTimes(4);
  });

  it('refreshes the current session and retains it when refresh fails', async () => {
    vi.mocked(getExecutionPreview).mockResolvedValue({
      eligibility: { status: 'ELIGIBLE' },
      session: session(),
    });
    vi.mocked(getPreviewSession)
      .mockResolvedValueOnce(session('STOPPED'))
      .mockRejectedValueOnce(
        new PreviewClientError('Refresh unavailable.', { code: 'API_ERROR', status: 503 }),
      );
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(async () => result.current.refreshSession());
    expect(getPreviewSession).toHaveBeenCalledWith(`preview-${'2'.repeat(32)}`);
    expect(result.current.state).toMatchObject({
      status: 'ready',
      control: { session: { status: 'STOPPED' } },
      actionError: null,
    });

    await act(async () => result.current.refreshSession());
    expect(result.current.state).toMatchObject({
      status: 'ready',
      control: { session: { status: 'STOPPED' } },
      actionError: 'Refresh unavailable.',
    });
  });

  it('aborts a pending load on unmount without publishing a cancellation error', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.mocked(getExecutionPreview).mockImplementation((_requestedExecutionId, options) => {
      observedSignal = options?.signal;
      return new Promise<never>((_resolve, reject) => {
        observedSignal?.addEventListener(
          'abort',
          () =>
            reject(
              new PreviewClientError('Cancelled.', {
                code: 'REQUEST_ABORTED',
              }),
            ),
          { once: true },
        );
      });
    });
    const { unmount } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() => expect(observedSignal).toBeDefined());

    unmount();

    expect(observedSignal?.aborted).toBe(true);
  });

  it('publishes only safe messages for initial load and stop failures', async () => {
    vi.mocked(getExecutionPreview)
      .mockRejectedValueOnce(new Error('private runtime details'))
      .mockResolvedValueOnce({ eligibility: { status: 'ELIGIBLE' }, session: session() });
    const { result } = renderHook(() => usePreviewSession(executionId, true));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'The Preview service is unavailable.',
      }),
    );

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    vi.mocked(stopPreviewSession).mockRejectedValue(
      new PreviewClientError('Stop unavailable.', { code: 'API_ERROR', status: 502 }),
    );
    await act(async () => result.current.stop());
    expect(result.current.state).toMatchObject({
      status: 'ready',
      control: { session: { status: 'RUNNING' } },
      actionError: 'Stop unavailable.',
    });
  });
});

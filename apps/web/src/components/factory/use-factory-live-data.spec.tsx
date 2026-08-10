import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionHistoryClientError } from '@/api/execution-history-client';
import type { ExecutionJobView } from '@/api/execution-contracts';
import type {
  ExecutionHistoryDetail,
  ExecutionHistoryTimeline,
} from '@/api/execution-history-contracts';
import { historyDetail, historyTimeline } from '@/test/history-fixtures';

import { useFactoryLiveData } from './use-factory-live-data';

const { getExecutionMock, getTimelineMock, getJobMock } = vi.hoisted(() => ({
  getExecutionMock: vi.fn(),
  getTimelineMock: vi.fn(),
  getJobMock: vi.fn(),
}));

vi.mock('@/api/execution-history-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/execution-history-client')>()),
  getExecution: getExecutionMock,
  getExecutionTimeline: getTimelineMock,
}));
vi.mock('@/api/execution-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/execution-client')>()),
  getJob: getJobMock,
}));

const EXECUTION_ID = historyDetail().executionId;

function LiveDataHarness({ executionId = EXECUTION_ID }: { readonly executionId?: string }) {
  const { state } = useFactoryLiveData(executionId);
  if (state.status !== 'ready') return <div data-testid="factory-state">{state.status}</div>;
  return (
    <div
      data-testid="factory-state"
      data-revision={state.model.execution.timelineRevision ?? 'none'}
      data-update-error={state.updateError ?? ''}
    >
      {state.model.execution.status}:
      {state.model.agents.map((agent) => `${agent.id}=${agent.status}`).join(',')}
    </div>
  );
}

function runningExecution(): ExecutionHistoryDetail {
  return historyDetail({
    status: 'RUNNING',
    readiness: null,
    finishedAt: null,
    durationMs: null,
    lineage: null,
    provenance: null,
    job: { ...historyDetail().job!, status: 'RUNNING', finishedAt: null },
  });
}

function runningTimeline(revision = 10): ExecutionHistoryTimeline {
  return historyTimeline({
    revision,
    status: 'RUNNING',
    summary: null,
    stages: historyTimeline().stages.map((stage) =>
      stage.stageId === 'PRODUCT_OWNER'
        ? { ...stage, status: 'RUNNING', finishedAt: null, durationMs: null }
        : stage.stageId === 'DEVELOPER' || stage.stageId === 'QA'
          ? {
              ...stage,
              status: 'PENDING',
              startedAt: null,
              finishedAt: null,
              durationMs: null,
            }
          : stage,
    ),
  });
}

function jobView(status: ExecutionJobView['status']): ExecutionJobView {
  const persisted = historyDetail().job!;
  const terminal = status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
  return {
    ...persisted,
    executionId: EXECUTION_ID,
    status,
    startedAt: status === 'QUEUED' ? null : persisted.startedAt,
    finishedAt: terminal ? persisted.finishedAt : null,
  };
}

function staleExecutionWithTerminalJob(
  status: Extract<ExecutionJobView['status'], 'SUCCESS' | 'FAILED' | 'CANCELLED'>,
): ExecutionHistoryDetail {
  return historyDetail({
    ...runningExecution(),
    job: { ...historyDetail().job!, status },
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getExecutionMock.mockReset();
  getTimelineMock.mockReset();
  getJobMock.mockReset();
  getJobMock.mockResolvedValue(jobView('RUNNING'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFactoryLiveData', () => {
  it('loads a terminal execution once without starting polling', async () => {
    getExecutionMock.mockResolvedValueOnce(historyDetail());
    getTimelineMock.mockResolvedValueOnce(historyTimeline());
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent('SUCCESS');
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '9');
    expect(getExecutionMock).toHaveBeenCalledOnce();
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(getJobMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'projects a terminal %s job over stale RUNNING execution metadata and stops immediately',
    async (status) => {
      getExecutionMock.mockResolvedValueOnce(staleExecutionWithTerminalJob(status));
      render(<LiveDataHarness />);
      await flush();

      expect(screen.getByTestId('factory-state')).toHaveTextContent(status);
      expect(screen.getByTestId('factory-state')).toHaveAttribute(
        'data-update-error',
        'Execution metadata is still reconciling; the terminal job status is shown.',
      );
      expect(getExecutionMock).toHaveBeenCalledOnce();
      expect(getTimelineMock).not.toHaveBeenCalled();
      expect(getJobMock).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(getExecutionMock).toHaveBeenCalledOnce();
      expect(getTimelineMock).not.toHaveBeenCalled();
      expect(getJobMock).not.toHaveBeenCalled();
    },
  );

  it('bounds final SUCCESS reconciliation and remains terminal when execution and timeline are stale', async () => {
    const stale = staleExecutionWithTerminalJob('SUCCESS');
    getExecutionMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
    getTimelineMock.mockResolvedValueOnce(runningTimeline(12));
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent('SUCCESS');
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '12');
    expect(screen.getByTestId('factory-state')).toHaveAttribute(
      'data-update-error',
      'Execution metadata is still reconciling; the terminal job status is shown.',
    );
    expect(getExecutionMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(getJobMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(getExecutionMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(getJobMock).not.toHaveBeenCalled();
  });

  it('polls one source per phase from queue to observable terminal result', async () => {
    const queued = historyDetail({
      status: 'CREATED',
      readiness: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      lineage: null,
      provenance: null,
      job: {
        ...historyDetail().job!,
        status: 'QUEUED',
        startedAt: null,
        finishedAt: null,
      },
    });
    getExecutionMock.mockResolvedValueOnce(queued).mockResolvedValueOnce(historyDetail());
    getJobMock.mockResolvedValueOnce({
      ...queued.job!,
      executionId: EXECUTION_ID,
      status: 'RUNNING',
      startedAt: '2026-08-07T10:00:00.000Z',
    });
    getTimelineMock
      .mockResolvedValueOnce(runningTimeline(10))
      .mockResolvedValueOnce(historyTimeline({ revision: 11 }))
      .mockResolvedValueOnce(historyTimeline({ revision: 11 }));
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent('QUEUED');
    expect(getTimelineMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(getJobMock).toHaveBeenCalledOnce();
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId('factory-state')).toHaveTextContent('PRODUCT_OWNER=WORKING');

    await act(async () => vi.advanceTimersByTimeAsync(750));
    await flush();
    expect(getExecutionMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('factory-state')).toHaveTextContent('SUCCESS');
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '11');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['FAILED', 'SUCCESS'] as const)(
    'reconciles a job that becomes %s while final execution metadata remains RUNNING',
    async (status) => {
      const stale = runningExecution();
      getExecutionMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
      getJobMock.mockResolvedValueOnce(jobView('RUNNING')).mockResolvedValueOnce(jobView(status));
      getTimelineMock.mockResolvedValue(historyTimeline({ revision: 16 }));
      render(<LiveDataHarness />);
      await flush();

      expect(screen.getByTestId('factory-state')).toHaveTextContent(status);
      expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '16');
      expect(screen.getByTestId('factory-state')).toHaveAttribute(
        'data-update-error',
        'Execution metadata is still reconciling; the terminal job status is shown.',
      );
      expect(getExecutionMock).toHaveBeenCalledTimes(2);
      expect(getTimelineMock).toHaveBeenCalledTimes(2);
      expect(getJobMock).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('keeps polling after a terminal timeline while the bounded job reconciliation is still RUNNING', async () => {
    const stale = runningExecution();
    getExecutionMock.mockResolvedValueOnce(stale).mockResolvedValueOnce(stale);
    getJobMock
      .mockResolvedValueOnce(jobView('RUNNING'))
      .mockResolvedValueOnce(jobView('RUNNING'))
      .mockResolvedValueOnce(jobView('FAILED'));
    getTimelineMock.mockResolvedValue(historyTimeline({ revision: 17 }));
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent('RUNNING');
    expect(getExecutionMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledTimes(2);
    expect(getJobMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByTestId('factory-state')).toHaveTextContent('FAILED');
    expect(getJobMock).toHaveBeenCalledTimes(3);
    expect(getTimelineMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale revisions and never regresses the rendered timeline', async () => {
    getExecutionMock.mockResolvedValueOnce(runningExecution());
    getTimelineMock
      .mockResolvedValueOnce(runningTimeline(7))
      .mockResolvedValueOnce(runningTimeline(6));
    render(<LiveDataHarness />);
    await flush();
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '7');

    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '7');
    expect(getTimelineMock).toHaveBeenCalledTimes(2);
  });

  it('reconciles the job while polling a RUNNING timeline and stops on terminal failure', async () => {
    getExecutionMock.mockResolvedValueOnce(runningExecution());
    getJobMock.mockResolvedValueOnce(jobView('RUNNING')).mockResolvedValueOnce(jobView('FAILED'));
    getTimelineMock.mockResolvedValueOnce(runningTimeline(15));
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent('RUNNING');
    expect(screen.getByTestId('factory-state')).toHaveAttribute('data-revision', '15');
    expect(getJobMock).toHaveBeenCalledOnce();
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByTestId('factory-state')).toHaveTextContent('FAILED');
    expect(getJobMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(getJobMock).toHaveBeenCalledTimes(2);
    expect(getTimelineMock).toHaveBeenCalledOnce();
  });

  it('stops after a polling error while retaining the last verified state', async () => {
    getExecutionMock.mockResolvedValueOnce(runningExecution());
    getTimelineMock.mockResolvedValueOnce(runningTimeline(4)).mockRejectedValueOnce(
      new ExecutionHistoryClientError('Live updates are unavailable.', {
        code: 'API_ERROR',
        status: 503,
      }),
    );
    render(<LiveDataHarness />);
    await flush();

    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByTestId('factory-state')).toHaveTextContent('RUNNING');
    expect(screen.getByTestId('factory-state')).toHaveAttribute(
      'data-update-error',
      'Live updates are unavailable.',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('represents a terminal execution without observability as not observed', async () => {
    getExecutionMock.mockResolvedValueOnce(
      historyDetail({ lineage: null, provenance: null, readiness: null }),
    );
    getTimelineMock.mockRejectedValueOnce(
      new ExecutionHistoryClientError('Timeline not found.', {
        code: 'API_ERROR',
        status: 404,
      }),
    );
    render(<LiveDataHarness />);
    await flush();

    expect(screen.getByTestId('factory-state')).toHaveTextContent(
      'PRODUCT_OWNER=NOT_OBSERVED,DEVELOPER=NOT_OBSERVED,QA=NOT_OBSERVED',
    );
  });

  it('aborts the active request and performs no late update after unmount', async () => {
    let signal: AbortSignal | undefined;
    getExecutionMock.mockImplementationOnce(
      async (_executionId: string, options: { readonly signal?: AbortSignal }) => {
        signal = options.signal;
        return await new Promise<ExecutionHistoryDetail>(() => undefined);
      },
    );
    const { unmount } = render(<LiveDataHarness />);
    await flush();
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

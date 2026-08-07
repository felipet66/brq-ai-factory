import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ExecutionHistoryClientError,
  getExecution,
  getExecutionTimeline,
} from '@/api/execution-history-client';
import { HISTORY_EXECUTION_ID, historyDetail, historyTimeline } from '@/test/history-fixtures';

import { ExecutionHistoryDetailExperience } from './execution-history-detail-experience';

vi.mock('@/api/execution-history-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/execution-history-client')>();
  return {
    ...actual,
    getExecution: vi.fn(),
    getExecutionTimeline: vi.fn(),
  };
});

const getExecutionMock = vi.mocked(getExecution);
const getExecutionTimelineMock = vi.mocked(getExecutionTimeline);

describe('ExecutionHistoryDetailExperience', () => {
  afterEach(cleanup);

  beforeEach(() => {
    getExecutionMock.mockReset();
    getExecutionTimelineMock.mockReset();
  });

  it('loads detail and timeline only through the history client', async () => {
    getExecutionMock.mockResolvedValueOnce(historyDetail());
    getExecutionTimelineMock.mockResolvedValueOnce(historyTimeline());
    render(<ExecutionHistoryDetailExperience executionId={HISTORY_EXECUTION_ID} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading execution details');
    expect(await screen.findByRole('heading', { name: 'Execution details' })).toBeInTheDocument();
    expect(screen.getByText('Customer Portal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Execution timeline' })).toBeInTheDocument();
    expect(screen.getByText('90 ms')).toBeInTheDocument();
    expect(screen.getAllByText('30')).toHaveLength(3);
    expect(getExecutionMock).toHaveBeenCalledWith(HISTORY_EXECUTION_ID, {
      signal: expect.any(AbortSignal),
    });
    expect(getExecutionTimelineMock).toHaveBeenCalledWith(HISTORY_EXECUTION_ID, {
      signal: expect.any(AbortSignal),
    });
  });

  it('renders API failures without exposing unexpected error details', async () => {
    getExecutionMock.mockRejectedValueOnce(
      new ExecutionHistoryClientError('Execution not found.', {
        code: 'API_ERROR',
        status: 404,
      }),
    );
    getExecutionTimelineMock.mockResolvedValueOnce(historyTimeline());
    const first = render(<ExecutionHistoryDetailExperience executionId={HISTORY_EXECUTION_ID} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Execution not found.');
    first.unmount();

    getExecutionMock.mockRejectedValueOnce(new Error('secret Prisma stack'));
    getExecutionTimelineMock.mockResolvedValueOnce(historyTimeline());
    render(<ExecutionHistoryDetailExperience executionId={HISTORY_EXECUTION_ID} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The execution history service could not process this request.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret Prisma stack');
  });

  it('renders persisted text as text and never as HTML', async () => {
    const unsafeProjectName = '<img src=x onerror=alert(1)>';
    getExecutionMock.mockResolvedValueOnce(historyDetail({ projectName: unsafeProjectName }));
    getExecutionTimelineMock.mockResolvedValueOnce(
      historyTimeline({
        stages: historyTimeline().stages.map((stage) =>
          stage.stageId === 'QA' ? { ...stage, stageName: '<script>alert(1)</script>' } : stage,
        ),
      }),
    );
    const { container } = render(
      <ExecutionHistoryDetailExperience executionId={HISTORY_EXECUTION_ID} />,
    );

    expect(await screen.findByText(unsafeProjectName)).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

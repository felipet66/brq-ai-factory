import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { historyDetail, historyPage, historyTimeline } from '@/test/history-fixtures';

import { ExecutionHistoryDetail } from './execution-history-detail';
import { ExecutionHistoryList } from './execution-history-list';
import { ExecutionHistoryTimeline } from './execution-history-timeline';

afterEach(cleanup);

describe('execution history presentation components', () => {
  it('renders all required list columns and disables pagination without a cursor', () => {
    render(
      <ExecutionHistoryList
        items={historyPage().items}
        hasNextPage={false}
        loadingNextPage={false}
        onNextPage={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    for (const heading of [
      'Execution ID',
      'Status',
      'Readiness',
      'Started at',
      'Duration',
      'Project name',
    ]) {
      expect(within(table).getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('does not link an execution until the backend assigns its identifier', () => {
    render(
      <ExecutionHistoryList
        items={[{ ...historyPage().items[0]!, executionId: null, status: 'CREATED' }]}
        hasNextPage
        loadingNextPage
        onNextPage={vi.fn()}
      />,
    );

    expect(screen.getByText('Pending assignment')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
  });

  it('does not link a reserved asynchronous execution before terminal detail exists', () => {
    const active = {
      ...historyPage().items[0]!,
      executionId: `execution-${'b'.repeat(32)}`,
      status: 'CREATED' as const,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    render(
      <ExecutionHistoryList
        items={[active]}
        hasNextPage={false}
        loadingNextPage={false}
        onNextPage={vi.fn()}
      />,
    );

    expect(screen.getByText(active.executionId)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nullable detail metadata honestly', () => {
    render(
      <ExecutionHistoryDetail
        execution={historyDetail({
          readiness: null,
          durationMs: null,
          startedAt: null,
          lineage: null,
          provenance: null,
          hashes: {
            ...historyDetail().hashes,
            workflowHash: null,
          },
        })}
      />,
    );

    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('Not available for this execution.')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Back to execution history' })).toHaveAttribute(
      'href',
      '/executions',
    );
  });

  it('renders persisted stage statuses and metrics', () => {
    const timeline = historyTimeline({
      stages: historyTimeline().stages.map((stage, index) => ({
        ...stage,
        status: ['SUCCESS', 'FAILED', 'SKIPPED', 'CANCELLED'][index] as
          'SUCCESS' | 'FAILED' | 'SKIPPED' | 'CANCELLED',
      })),
      stageMetrics: historyTimeline().stageMetrics.map((metrics) => ({
        ...metrics,
        totalTokens: null,
      })),
    });
    const { container } = render(<ExecutionHistoryTimeline timeline={timeline} />);

    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('SKIPPED')).toBeInTheDocument();
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('[data-status="FAILED"]')).not.toBeNull();
  });
});

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExecutionSummary } from '@/api/execution-contracts';

import { ExecutionTimeline } from './execution-timeline';

afterEach(cleanup);

function observability(
  statuses: readonly [
    'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'RUNNING' | 'PENDING',
    'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'RUNNING' | 'PENDING',
    'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'RUNNING' | 'PENDING',
    'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED' | 'RUNNING' | 'PENDING',
  ],
): Exclude<ExecutionSummary['observability'], null> {
  const identities = [
    ['KNOWLEDGE', 'Knowledge'],
    ['PRODUCT_OWNER', 'Product Owner'],
    ['DEVELOPER', 'Developer'],
    ['QA', 'QA'],
  ] as const;
  return {
    revision: 4,
    status: statuses.includes('RUNNING') ? 'RUNNING' : 'FAILED',
    stages: identities.map(([stageId, stageName], index) => ({
      stageId,
      stageName,
      status: statuses[index]!,
      durationMs: statuses[index] === 'PENDING' ? null : index + 1,
    })),
    stageMetrics: [],
    summary: null,
  };
}

describe('ExecutionTimeline', () => {
  it('renders honest pending stages before the first backend snapshot', () => {
    render(<ExecutionTimeline loading observability={null} />);

    expect(screen.getByRole('heading', { name: 'Execution timeline' })).toBeInTheDocument();
    expect(screen.getAllByText('Pending')).toHaveLength(4);
    expect(
      screen.getByText('Waiting for execution metadata. The workflow continues normally.'),
    ).toBeInTheDocument();
  });

  it('labels unavailable terminal metadata without calling it live', () => {
    render(<ExecutionTimeline observability={null} />);

    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Live metadata')).not.toBeInTheDocument();
    expect(
      screen.getByText('Timeline metadata is not available for this execution.'),
    ).toBeInTheDocument();
  });

  it('renders success, running, failure and skipped metadata accessibly', () => {
    const { container } = render(
      <ExecutionTimeline
        observability={observability(['SUCCESS', 'RUNNING', 'FAILED', 'SKIPPED'])}
      />,
    );

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(4);
    expect(container.querySelector('[data-status="FAILED"]')).not.toBeNull();
    expect(container.querySelector('[data-status="SKIPPED"]')).not.toBeNull();
  });

  it('renders cancellation distinctly and never interprets stage names as HTML', () => {
    const snapshot = observability(['SUCCESS', 'CANCELLED', 'SKIPPED', 'SKIPPED']);
    const unsafe = {
      ...snapshot,
      stages: snapshot.stages.map((stage) =>
        stage.stageId === 'PRODUCT_OWNER'
          ? { ...stage, stageName: '<img src=x onerror=alert(1)>' }
          : stage,
      ),
    };
    const { container } = render(<ExecutionTimeline observability={unsafe} />);

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});

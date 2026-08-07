import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExecutionJobStatus, ExecutionJobView } from '@/api/execution-contracts';

import { ExecutionJobProgress } from './execution-job-progress';

function job(status: ExecutionJobStatus, startedAt: string | null = null): ExecutionJobView {
  return {
    executionId: `execution-${'a'.repeat(32)}`,
    jobId: `job-${'b'.repeat(32)}`,
    status,
    queuedAt: '2026-08-07T18:00:00.000Z',
    startedAt,
    finishedAt:
      status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED'
        ? '2026-08-07T18:00:02.000Z'
        : null,
  };
}

afterEach(cleanup);

describe('ExecutionJobProgress', () => {
  it.each([
    ['QUEUED', ['RUNNING', 'PENDING', 'PENDING']],
    ['RUNNING', ['SUCCESS', 'RUNNING', 'PENDING']],
    ['SUCCESS', ['SUCCESS', 'SUCCESS', 'SUCCESS']],
    ['FAILED', ['SUCCESS', 'FAILED', 'FAILED']],
    ['CANCELLED', ['SUCCESS', 'CANCELLED', 'CANCELLED']],
  ] as const)('renders the ordered %s lifecycle', (status, expectedStatuses) => {
    const { container } = render(
      <ExecutionJobProgress
        job={job(status, status === 'QUEUED' ? null : '2026-08-07T18:00:01.000Z')}
      />,
    );

    expect(screen.getByText('Fila')).toBeInTheDocument();
    expect(screen.getByText('Executando')).toBeInTheDocument();
    expect(screen.getByText('Finalizado')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('li')].map((item) => item.getAttribute('data-status')),
    ).toEqual(expectedStatuses);
  });

  it('marks execution as skipped when cancellation happens before start', () => {
    const { container } = render(<ExecutionJobProgress job={job('CANCELLED')} />);

    expect(screen.getByText('Ignorado')).toBeInTheDocument();
    expect(container.querySelectorAll('li')[1]).toHaveAttribute('data-status', 'SKIPPED');
  });

  it('renders labels as text and never interprets job identifiers as HTML', () => {
    const { container } = render(<ExecutionJobProgress job={null} />);

    expect(screen.getByText('Fila')).toBeInTheDocument();
    expect(screen.getByText('Executando')).toBeInTheDocument();
    expect(screen.getByText('Finalizado')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });
});

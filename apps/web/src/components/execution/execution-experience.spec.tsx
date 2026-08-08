import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enqueueExecution } from '@/api/execution-client';
import type { ExecutionJobStatus, ExecutionJobView } from '@/api/execution-contracts';

import { ExecutionExperience } from './execution-experience';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/api/execution-client', () => ({ enqueueExecution: vi.fn() }));

const enqueueExecutionMock = vi.mocked(enqueueExecution);
const EXECUTION_ID = `execution-${'a'.repeat(32)}`;

function job(status: ExecutionJobStatus, started = status !== 'QUEUED'): ExecutionJobView {
  return {
    executionId: EXECUTION_ID,
    jobId: `job-${'b'.repeat(32)}`,
    status,
    queuedAt: '2026-08-07T18:00:00.000Z',
    startedAt: started ? '2026-08-07T18:00:01.000Z' : null,
    finishedAt:
      status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED'
        ? '2026-08-07T18:00:02.000Z'
        : null,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText('Project Name'), {
    target: { value: 'Customer Portal' },
  });
  fireEvent.change(screen.getByLabelText('Objective'), {
    target: { value: 'Let customers track their orders.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Execute Workflow' }));
}

function clientError(message: string): Error {
  const error = new Error(message);
  error.name = 'ExecutionClientError';
  return error;
}

describe('ExecutionExperience asynchronous flow', () => {
  afterEach(cleanup);

  beforeEach(() => {
    enqueueExecutionMock.mockReset();
    pushMock.mockReset();
  });

  it('enqueues once and navigates immediately to the live Factory View', async () => {
    const pending = deferred<ExecutionJobView>();
    enqueueExecutionMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionExperience />);

    expect(screen.getByText(/Ready to coordinate/)).toBeInTheDocument();
    fillAndSubmit();

    expect(screen.getByRole('heading', { name: 'Workflow queued' })).toBeInTheDocument();
    expect(screen.getByText('Fila')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeDisabled();
    expect(enqueueExecutionMock).toHaveBeenCalledWith(
      {
        projectName: 'Customer Portal',
        objective: 'Let customers track their orders.',
      },
      { signal: expect.any(AbortSignal) },
    );

    pending.resolve(job('QUEUED', false));
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(`/executions/${EXECUTION_ID}/factory`),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Workflow queued. Opening Factory View.');
  });

  it('renders a safe client error without navigating', async () => {
    enqueueExecutionMock.mockRejectedValueOnce(clientError('The API is unavailable.'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The API is unavailable.');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not expose messages from unexpected errors', async () => {
    enqueueExecutionMock.mockRejectedValueOnce(new Error('internal secret and stack context'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The execution service could not process this request.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('internal secret');
  });

  it('blocks duplicate submissions while the enqueue request is pending', () => {
    const pending = deferred<ExecutionJobView>();
    enqueueExecutionMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionExperience />);

    fillAndSubmit();
    const form = screen.getByRole('button', { name: 'Execute Workflow' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(enqueueExecutionMock).toHaveBeenCalledOnce();
  });

  it('aborts the enqueue request when unmounted and ignores later acceptance', async () => {
    const pending = deferred<ExecutionJobView>();
    let capturedSignal: AbortSignal | undefined;
    enqueueExecutionMock.mockImplementationOnce((_input, options) => {
      capturedSignal = options?.signal;
      return pending.promise;
    });
    const { unmount } = render(<ExecutionExperience />);

    fillAndSubmit();
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    pending.resolve(job('QUEUED', false));
    await waitFor(() => expect(enqueueExecutionMock).toHaveBeenCalledOnce());
    expect(pushMock).not.toHaveBeenCalled();
  });
});

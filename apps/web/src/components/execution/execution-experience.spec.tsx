import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeWorkflow } from '@/api/execution-client';
import type { ExecutionJobStatus, ExecutionJobView } from '@/api/execution-contracts';

import { ExecutionExperience } from './execution-experience';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/api/execution-client', () => ({ executeWorkflow: vi.fn() }));

const executeWorkflowMock = vi.mocked(executeWorkflow);
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
    executeWorkflowMock.mockReset();
    pushMock.mockReset();
  });

  it('renders queue and running updates, then navigates on success', async () => {
    const pending = deferred<ExecutionJobView>();
    let publish: ((update: ExecutionJobView) => void) | undefined;
    executeWorkflowMock.mockImplementationOnce((_input, options) => {
      publish = options?.onJobUpdate;
      return pending.promise;
    });
    render(<ExecutionExperience />);

    expect(screen.getByText(/Ready to coordinate/)).toBeInTheDocument();
    fillAndSubmit();

    expect(screen.getByRole('heading', { name: 'Workflow queued' })).toBeInTheDocument();
    expect(screen.getByText('Fila')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeDisabled();
    expect(executeWorkflowMock).toHaveBeenCalledWith(
      {
        projectName: 'Customer Portal',
        objective: 'Let customers track their orders.',
      },
      { signal: expect.any(AbortSignal), onJobUpdate: expect.any(Function) },
    );

    act(() => publish?.(job('QUEUED', false)));
    expect(screen.getByRole('status')).toHaveTextContent('Workflow queued.');

    act(() => publish?.(job('RUNNING')));
    expect(screen.getByRole('heading', { name: 'Executing workflow' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Workflow running.');
    expect(screen.getByText('Em andamento')).toBeInTheDocument();

    await act(async () => pending.resolve(job('SUCCESS')));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/executions/${EXECUTION_ID}`));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Workflow complete. Opening execution details.',
    );
  });

  it.each([
    ['FAILED', 'The workflow finished with a failure.'],
    ['CANCELLED', 'The workflow was cancelled.'],
  ] as const)('shows %s as an error and does not navigate', async (status, message) => {
    executeWorkflowMock.mockImplementationOnce(async (_input, options) => {
      options?.onJobUpdate?.(job('RUNNING'));
      return job(status);
    });
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getAllByText(status === 'FAILED' ? 'Falhou' : 'Cancelado')).toHaveLength(2);
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeEnabled();
  });

  it('renders a safe client error without navigating', async () => {
    executeWorkflowMock.mockRejectedValueOnce(clientError('The API is unavailable.'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The API is unavailable.');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not expose messages from unexpected errors', async () => {
    executeWorkflowMock.mockRejectedValueOnce(new Error('internal secret and stack context'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The execution service could not process this request.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('internal secret');
  });

  it('blocks duplicate submissions while polling', () => {
    const pending = deferred<ExecutionJobView>();
    executeWorkflowMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionExperience />);

    fillAndSubmit();
    const form = screen.getByRole('button', { name: 'Execute Workflow' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(executeWorkflowMock).toHaveBeenCalledOnce();
  });

  it('aborts polling when unmounted and ignores later completion', async () => {
    const pending = deferred<ExecutionJobView>();
    let capturedSignal: AbortSignal | undefined;
    executeWorkflowMock.mockImplementationOnce((_input, options) => {
      capturedSignal = options?.signal;
      return pending.promise;
    });
    const { unmount } = render(<ExecutionExperience />);

    fillAndSubmit();
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);

    pending.resolve(job('SUCCESS'));
    await waitFor(() => expect(executeWorkflowMock).toHaveBeenCalledOnce());
    expect(pushMock).not.toHaveBeenCalled();
  });
});

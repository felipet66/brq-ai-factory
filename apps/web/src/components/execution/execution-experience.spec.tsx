import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeWorkflow } from '@/api/execution-client';
import type { ExecutionSummary } from '@/api/execution-contracts';

import { ExecutionExperience } from './execution-experience';

vi.mock('@/api/execution-client', () => ({ executeWorkflow: vi.fn() }));

const executeWorkflowMock = vi.mocked(executeWorkflow);

function executionSummary(): ExecutionSummary {
  return {
    executionId: `execution-${'a'.repeat(32)}`,
    status: 'SUCCESS',
    durationMs: 25,
    readiness: 'READY',
    hashes: {
      executionRequestHash: '1'.repeat(64),
      workflowRequestHash: '2'.repeat(64),
      workflowHash: '3'.repeat(64),
      lineageHash: '4'.repeat(64),
      provenanceHash: '5'.repeat(64),
      executionHash: '6'.repeat(64),
    },
    lineage: { outputCount: 3, verifiedHandoffs: 3 },
    provenance: {
      stages: [
        {
          stage: 'QA',
          agentVersion: '1.0.0',
          outcome: 'GENERATED',
          readiness: 'READY',
        },
      ],
    },
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

describe('ExecutionExperience', () => {
  afterEach(cleanup);

  beforeEach(() => {
    executeWorkflowMock.mockReset();
  });

  it('transitions from idle through loading to a successful response', async () => {
    const pending = deferred<ExecutionSummary>();
    executeWorkflowMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionExperience />);

    expect(screen.getByText(/Ready to coordinate/)).toBeInTheDocument();
    fillAndSubmit();

    expect(screen.getByRole('status')).toHaveTextContent('Executing workflow');
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeDisabled();
    expect(executeWorkflowMock).toHaveBeenCalledWith(
      {
        projectName: 'Customer Portal',
        objective: 'Let customers track their orders.',
      },
      { signal: expect.any(AbortSignal) },
    );

    pending.resolve(executionSummary());
    expect(await screen.findByRole('heading', { name: 'Execution result' })).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
  });

  it('renders a safe error state when the client rejects', async () => {
    executeWorkflowMock.mockRejectedValueOnce(clientError('The API is unavailable.'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The API is unavailable.');
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeEnabled();
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

  it('blocks duplicate submissions while a request is active', () => {
    const pending = deferred<ExecutionSummary>();
    executeWorkflowMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionExperience />);

    fillAndSubmit();
    const form = screen.getByRole('button', { name: 'Execute Workflow' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(executeWorkflowMock).toHaveBeenCalledOnce();
  });

  it('aborts the active HTTP request when unmounted', async () => {
    const pending = deferred<ExecutionSummary>();
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

    pending.resolve(executionSummary());
    await waitFor(() => expect(executeWorkflowMock).toHaveBeenCalledOnce());
  });
});

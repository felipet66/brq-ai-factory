import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    observability: null,
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
      { signal: expect.any(AbortSignal), onObservability: expect.any(Function) },
    );

    pending.resolve(executionSummary());
    expect(await screen.findByRole('heading', { name: 'Execution result' })).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Workflow complete. Status SUCCESS.');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('renders live backend timeline updates without replacing the loading state', async () => {
    const pending = deferred<ExecutionSummary>();
    let publish:
      ((observability: Exclude<ExecutionSummary['observability'], null>) => void) | undefined;
    executeWorkflowMock.mockImplementationOnce((_input, options) => {
      publish = options?.onObservability;
      return pending.promise;
    });
    render(<ExecutionExperience />);

    fillAndSubmit();
    expect(
      screen.getByText('Waiting for execution metadata. The workflow continues normally.'),
    ).toBeInTheDocument();

    act(() => {
      publish?.({
        revision: 3,
        status: 'RUNNING',
        stages: [
          { stageId: 'KNOWLEDGE', stageName: 'Knowledge', status: 'SUCCESS', durationMs: 2 },
          {
            stageId: 'PRODUCT_OWNER',
            stageName: 'Product Owner',
            status: 'RUNNING',
            durationMs: null,
          },
          { stageId: 'DEVELOPER', stageName: 'Developer', status: 'PENDING', durationMs: null },
          { stageId: 'QA', stageName: 'QA', status: 'PENDING', durationMs: null },
        ],
        stageMetrics: [],
        summary: null,
      });
    });

    expect(await screen.findByText('In progress')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Executing workflow. Product Owner is in progress.',
    );
    expect(screen.queryByText(/Waiting for execution metadata/)).not.toBeInTheDocument();

    pending.resolve(executionSummary());
    await screen.findByRole('heading', { name: 'Execution result' });
    expect(screen.getByRole('status')).toHaveTextContent('Workflow complete. Status SUCCESS.');
  });

  it('renders a safe error state when the client rejects', async () => {
    executeWorkflowMock.mockRejectedValueOnce(clientError('The API is unavailable.'));
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The API is unavailable.');
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeEnabled();
  });

  it('preserves terminal timeline metadata when the workflow transport fails', async () => {
    executeWorkflowMock.mockImplementationOnce(async (_input, options) => {
      options?.onObservability?.({
        revision: 5,
        status: 'FAILED',
        stages: [
          { stageId: 'KNOWLEDGE', stageName: 'Knowledge', status: 'SUCCESS', durationMs: 2 },
          {
            stageId: 'PRODUCT_OWNER',
            stageName: 'Product Owner',
            status: 'FAILED',
            durationMs: 4,
          },
          { stageId: 'DEVELOPER', stageName: 'Developer', status: 'SKIPPED', durationMs: null },
          { stageId: 'QA', stageName: 'QA', status: 'SKIPPED', durationMs: null },
        ],
        stageMetrics: [],
        summary: null,
      });
      throw clientError('The workflow failed.');
    });
    render(<ExecutionExperience />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('The workflow failed.');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByText('Skipped')).toHaveLength(2);
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

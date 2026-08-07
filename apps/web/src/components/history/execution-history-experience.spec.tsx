import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionHistoryClientError, listExecutions } from '@/api/execution-history-client';
import { HISTORY_EXECUTION_ID, historyPage } from '@/test/history-fixtures';

import { ExecutionHistoryExperience } from './execution-history-experience';

vi.mock('@/api/execution-history-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/execution-history-client')>();
  return { ...actual, listExecutions: vi.fn() };
});

const listExecutionsMock = vi.mocked(listExecutions);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('ExecutionHistoryExperience', () => {
  afterEach(cleanup);

  beforeEach(() => {
    listExecutionsMock.mockReset();
  });

  it('renders loading and then the persisted execution list', async () => {
    const pending = deferred<ReturnType<typeof historyPage>>();
    listExecutionsMock.mockReturnValueOnce(pending.promise);
    render(<ExecutionHistoryExperience />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading execution history');
    expect(listExecutionsMock).toHaveBeenCalledWith(
      { limit: 20 },
      { signal: expect.any(AbortSignal) },
    );

    pending.resolve(historyPage());

    expect(await screen.findByRole('heading', { name: 'Executions' })).toBeInTheDocument();
    expect(screen.getByText('Customer Portal')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
    expect(screen.getByText('250 ms')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: HISTORY_EXECUTION_ID })).toHaveAttribute(
      'href',
      `/executions/${HISTORY_EXECUTION_ID}`,
    );
  });

  it('loads the next page from the opaque backend cursor', async () => {
    listExecutionsMock
      .mockResolvedValueOnce(historyPage({ nextCursor: 'cursor-002' }))
      .mockResolvedValueOnce(
        historyPage({
          items: [
            {
              ...historyPage().items[0]!,
              executionId: `execution-${'b'.repeat(32)}`,
              workflowId: 'workflow-002',
              projectName: 'Billing Portal',
            },
          ],
        }),
      );
    render(<ExecutionHistoryExperience />);

    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Billing Portal')).toBeInTheDocument();
    expect(listExecutionsMock).toHaveBeenNthCalledWith(
      2,
      { limit: 20, cursor: 'cursor-002' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('renders an honest empty state', async () => {
    listExecutionsMock.mockResolvedValueOnce(historyPage({ items: [] }));
    render(<ExecutionHistoryExperience />);

    expect(await screen.findByText('No executions yet')).toBeInTheDocument();
    expect(screen.getByText(/will appear here/i)).toBeInTheDocument();
  });

  it('renders sanitized known and unexpected failures', async () => {
    listExecutionsMock.mockRejectedValueOnce(
      new ExecutionHistoryClientError('Execution history is unavailable.', {
        code: 'NETWORK_ERROR',
      }),
    );
    const first = render(<ExecutionHistoryExperience />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Execution history is unavailable.');
    first.unmount();

    listExecutionsMock.mockRejectedValueOnce(new Error('secret database details'));
    render(<ExecutionHistoryExperience />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The execution history service could not process this request.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret database');
  });

  it('aborts the active history request when unmounted', async () => {
    const pending = deferred<ReturnType<typeof historyPage>>();
    let signal: AbortSignal | undefined;
    listExecutionsMock.mockImplementationOnce((_filters, options) => {
      signal = options?.signal;
      return pending.promise;
    });
    const { unmount } = render(<ExecutionHistoryExperience />);

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve(historyPage());
    await waitFor(() => expect(listExecutionsMock).toHaveBeenCalledOnce());
  });
});

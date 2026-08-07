import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listExecutions } from '@/api/execution-history-client';
import { historyPage } from '@/test/history-fixtures';

import ExecutionHistoryPage from './page';

vi.mock('@/api/execution-history-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/execution-history-client')>();
  return { ...actual, listExecutions: vi.fn() };
});

afterEach(cleanup);

describe('ExecutionHistoryPage', () => {
  it('identifies the persisted execution history experience', async () => {
    vi.mocked(listExecutions).mockResolvedValueOnce(historyPage());
    render(<ExecutionHistoryPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Execution History' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/without exposing prompts/i)).toBeInTheDocument();
    expect(await screen.findByText('Customer Portal')).toBeInTheDocument();
  });
});

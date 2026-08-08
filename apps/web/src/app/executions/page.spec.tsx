import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listExecutions } from '@/api/execution-history-client';
import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';
import { historyPage } from '@/test/history-fixtures';

import ExecutionHistoryPage from './page';

vi.mock('@/api/execution-history-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/execution-history-client')>();
  return { ...actual, listExecutions: vi.fn() };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(listExecutions).mockReset();
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue(AUTHENTICATED_USER);
});

afterEach(cleanup);

describe('ExecutionHistoryPage', () => {
  it('identifies the persisted execution history experience', async () => {
    vi.mocked(listExecutions).mockResolvedValueOnce(historyPage());
    render(await ExecutionHistoryPage());

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Open current user profile' })).toHaveTextContent(
      AUTHENTICATED_USER.name,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Execution History' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/without exposing prompts/i)).toBeInTheDocument();
    expect(await screen.findByText('Customer Portal')).toBeInTheDocument();
  });

  it('does not start the history client when the session guard redirects', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(ExecutionHistoryPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(listExecutions).not.toHaveBeenCalled();
  });
});

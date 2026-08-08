import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import ExecutionDetailsPage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/components/history/execution-history-detail-experience', () => ({
  ExecutionHistoryDetailExperience: ({ executionId }: { readonly executionId: string }) => (
    <main>
      <h1>Execution Detail</h1>
      <span>{executionId}</span>
    </main>
  ),
}));

beforeEach(() => {
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue(AUTHENTICATED_USER);
});

afterEach(cleanup);

describe('ExecutionDetailsPage', () => {
  it('requires a server session before rendering the requested execution', async () => {
    render(
      await ExecutionDetailsPage({
        params: Promise.resolve({ id: 'execution-001' }),
      }),
    );

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Open current user profile' })).toHaveTextContent(
      AUTHENTICATED_USER.name,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Execution Detail' })).toBeInTheDocument();
    expect(screen.getByText('execution-001')).toBeInTheDocument();
  });

  it('does not resolve or render execution details after an anonymous redirect', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(
      ExecutionDetailsPage({ params: Promise.resolve({ id: 'execution-001' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });
});

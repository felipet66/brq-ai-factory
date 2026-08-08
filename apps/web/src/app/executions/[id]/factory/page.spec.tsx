import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import ExecutionFactoryPage from './page';

const STANDARD_USER = Object.freeze({ ...AUTHENTICATED_USER, role: 'USER' as const });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/components/factory/factory-experience', () => ({
  FactoryExperience: ({
    executionId,
    canAccessPlayground,
  }: {
    readonly executionId: string;
    readonly canAccessPlayground: boolean;
  }) => (
    <main>
      <h1>AI Software Factory</h1>
      <span>{executionId}</span>
      <span>{canAccessPlayground ? 'Playground enabled' : 'Playground hidden'}</span>
    </main>
  ),
}));

beforeEach(() => {
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue(STANDARD_USER);
});

afterEach(cleanup);

describe('ExecutionFactoryPage', () => {
  it('requires authentication and opens the requested factory for a USER', async () => {
    render(
      await ExecutionFactoryPage({
        params: Promise.resolve({ id: 'execution-001' }),
      }),
    );

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 1, name: 'AI Software Factory' })).toBeVisible();
    expect(screen.getByText('execution-001')).toBeVisible();
    expect(screen.getByText('Playground hidden')).toBeVisible();
  });

  it('enables the existing Playground navigation only for ADMIN', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce(AUTHENTICATED_USER);

    render(
      await ExecutionFactoryPage({
        params: Promise.resolve({ id: 'execution-002' }),
      }),
    );

    expect(screen.getByText('Playground enabled')).toBeVisible();
  });

  it('does not render factory data after an anonymous redirect', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(
      ExecutionFactoryPage({ params: Promise.resolve({ id: 'execution-001' }) }),
    ).rejects.toThrow('NEXT_REDIRECT');
  });
});

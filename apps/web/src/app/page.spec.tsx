import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import HomePage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue(AUTHENTICATED_USER);
});

afterEach(cleanup);

describe('HomePage', () => {
  it('requires a server session and exposes the authenticated execution experience', async () => {
    render(await HomePage());

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Open current user profile' })).toHaveTextContent(
      AUTHENTICATED_USER.name,
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'BRQ AI Factory' })).toBeInTheDocument();
    expect(screen.getByText(/deterministic workflow/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Project Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Objective')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute Workflow' })).toBeInTheDocument();
  });

  it('does not render when the server session guard redirects an anonymous request', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(HomePage()).rejects.toThrow('NEXT_REDIRECT');
  });
});

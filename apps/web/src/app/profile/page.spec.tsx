import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import ProfilePage from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(requireAuthenticatedUser).mockReset();
  vi.mocked(requireAuthenticatedUser).mockResolvedValue(AUTHENTICATED_USER);
});

afterEach(cleanup);

describe('ProfilePage', () => {
  it('requires a server session and renders only the public authenticated-user projection', async () => {
    render(await ProfilePage());

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument();
    expect(screen.getAllByText(AUTHENTICATED_USER.name)).toHaveLength(2);
    expect(screen.getAllByText(AUTHENTICATED_USER.email).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/password|token|cookie|session id/i);
  });

  it('does not render profile data after an anonymous redirect', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(ProfilePage()).rejects.toThrow('NEXT_REDIRECT');
  });
});

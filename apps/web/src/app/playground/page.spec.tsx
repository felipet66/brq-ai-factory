import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import PlaygroundPage from './page';

const navigation = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: navigation.notFound,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/server/auth/session', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/components/playground/playground-experience', () => ({
  PlaygroundExperience: () => <div>Protected Playground experience</div>,
}));

describe('PlaygroundPage authorization', () => {
  beforeEach(() => {
    vi.mocked(requireAuthenticatedUser).mockReset();
    navigation.notFound.mockClear();
    vi.mocked(requireAuthenticatedUser).mockResolvedValue(AUTHENTICATED_USER);
  });

  afterEach(cleanup);

  it('renders the protected experience and navigation for an ADMIN', async () => {
    render(await PlaygroundPage());

    expect(requireAuthenticatedUser).toHaveBeenCalledOnce();
    expect(navigation.notFound).not.toHaveBeenCalled();
    expect(screen.getByText('Protected Playground experience')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Playground' })).toHaveAttribute('href', '/playground');
    expect(screen.getByRole('link', { name: 'Open current user profile' })).toHaveTextContent(
      AUTHENTICATED_USER.name,
    );
  });

  it('returns not-found for an authenticated USER', async () => {
    vi.mocked(requireAuthenticatedUser).mockResolvedValueOnce({
      ...AUTHENTICATED_USER,
      role: 'USER',
    });

    await expect(PlaygroundPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(navigation.notFound).toHaveBeenCalledOnce();
  });

  it('lets the shared session guard redirect anonymous requests before role checks', async () => {
    vi.mocked(requireAuthenticatedUser).mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(PlaygroundPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

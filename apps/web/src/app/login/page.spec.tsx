import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOptionalAuthenticatedUser } from '@/server/auth/session';
import { AUTHENTICATED_USER } from '@/test/auth-fixtures';

import LoginPage from './page';

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  redirect: navigation.redirect,
}));
vi.mock('@/server/auth/session', () => ({ getOptionalAuthenticatedUser: vi.fn() }));

beforeEach(() => {
  vi.mocked(getOptionalAuthenticatedUser).mockReset();
  vi.mocked(getOptionalAuthenticatedUser).mockResolvedValue(null);
  navigation.redirect.mockReset();
});

afterEach(cleanup);

describe('LoginPage', () => {
  it('identifies the protected platform and exposes only the login form to anonymous users', async () => {
    render(await LoginPage());

    expect(getOptionalAuthenticatedUser).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/token|session id|cookie/i);
  });

  it('redirects an already authenticated user away from login', async () => {
    vi.mocked(getOptionalAuthenticatedUser).mockResolvedValueOnce(AUTHENTICATED_USER);
    navigation.redirect.mockImplementationOnce(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(LoginPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(navigation.redirect).toHaveBeenCalledOnce();
    expect(navigation.redirect).toHaveBeenCalledWith('/');
  });
});

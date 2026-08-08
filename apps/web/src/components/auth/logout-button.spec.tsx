import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthClientError, logout } from '@/api/auth-client';

import { LogoutButton } from './logout-button';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/api/auth-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/auth-client')>();
  return { ...actual, logout: vi.fn() };
});

const logoutMock = vi.mocked(logout);

afterEach(() => {
  cleanup();
  logoutMock.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
});

describe('LogoutButton', () => {
  it('disables duplicate interaction and redirects only after the server confirms logout', async () => {
    let resolve!: () => void;
    logoutMock.mockReturnValueOnce(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    expect(logoutMock).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
    expect(navigation.replace).not.toHaveBeenCalled();

    resolve();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/login'));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it('renders only safe errors and allows retry', async () => {
    logoutMock
      .mockRejectedValueOnce(
        new AuthClientError('Não foi possível encerrar a sessão.', {
          code: 'API_ERROR',
          status: 503,
        }),
      )
      .mockRejectedValueOnce(new Error('private cookie value'));
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível encerrar a sessão.',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to sign out'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('private cookie');
  });

  it('aborts an in-flight logout when removed', () => {
    let signal: AbortSignal | undefined;
    logoutMock.mockImplementationOnce((options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    const view = render(<LogoutButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    view.unmount();

    expect(signal?.aborted).toBe(true);
  });
});

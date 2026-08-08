import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthClientError, login } from '@/api/auth-client';

import { LoginForm } from './login-form';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/api/auth-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/auth-client')>();
  return { ...actual, login: vi.fn() };
});

const loginMock = vi.mocked(login);
const USER = {
  id: 'user-001',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'ADMIN' as const,
  createdAt: '2026-08-07T12:00:00.000Z',
  updatedAt: '2026-08-07T12:05:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fillAndSubmit(): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'safe-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
}

afterEach(() => {
  cleanup();
  loginMock.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
});

describe('LoginForm', () => {
  it('renders accessible credential fields without exposing session controls', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(document.body.textContent).not.toMatch(/token|session id/i);
  });

  it('shows loading, submits exactly once and redirects after authentication', async () => {
    const pending = deferred<typeof USER>();
    loginMock.mockReturnValueOnce(pending.promise);
    render(<LoginForm />);

    fillAndSubmit();

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying credentials…');
    expect(loginMock).toHaveBeenCalledOnce();
    expect(loginMock).toHaveBeenCalledWith(
      { email: 'ada@example.com', password: 'safe-password' },
      { signal: expect.any(AbortSignal) },
    );

    pending.resolve(USER);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'));
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it('renders a safe client error and allows a new attempt', async () => {
    loginMock.mockRejectedValueOnce(
      new AuthClientError('Email ou senha inválidos.', { code: 'API_ERROR', status: 401 }),
    );
    render(<LoginForm />);

    fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Email ou senha inválidos.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('does not expose unexpected errors or update state after unmount', async () => {
    loginMock.mockRejectedValueOnce(new Error('DATABASE_URL=file:private.db'));
    const first = render(<LoginForm />);
    fillAndSubmit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('authentication service could not process');
    expect(alert).not.toHaveTextContent('private.db');
    first.unmount();

    let capturedSignal: AbortSignal | undefined;
    loginMock.mockImplementationOnce((_credentials, options) => {
      capturedSignal = options?.signal;
      return new Promise(() => undefined);
    });
    const second = render(<LoginForm />);
    fillAndSubmit();
    second.unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

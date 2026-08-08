'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { AuthClientError, login } from '@/api/auth-client';

import { AuthErrorState } from './auth-error-state';
import { AuthLoadingState } from './auth-loading-state';
import styles from './auth.module.css';

type LoginState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string };

const FALLBACK_ERROR_MESSAGE = 'The authentication service could not process this request.';

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof AuthClientError)) return FALLBACK_ERROR_MESSAGE;
  const message = error.message.trim();
  return message.length > 0 && message.length <= 300 ? message : FALLBACK_ERROR_MESSAGE;
}

export function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState<LoginState>({ status: 'idle' });
  const inFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;

    inFlight.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    setState({ status: 'loading' });

    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      await login(
        {
          email: String(formData.get('email') ?? ''),
          password: String(formData.get('password') ?? ''),
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;

      form.reset();
      router.replace('/');
      router.refresh();
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({ status: 'error', message: safeErrorMessage(error) });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        inFlight.current = false;
      }
    }
  }

  const loading = state.status === 'loading';
  return (
    <form className={styles.loginForm} onSubmit={handleSubmit} aria-busy={loading}>
      <div className={styles.field}>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          required
          disabled={loading}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={512}
          required
          disabled={loading}
        />
      </div>

      <button className={styles.primaryButton} type="submit" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>

      {state.status === 'loading' ? <AuthLoadingState label="Verifying credentials…" /> : null}
      {state.status === 'error' ? <AuthErrorState message={state.message} /> : null}
    </form>
  );
}

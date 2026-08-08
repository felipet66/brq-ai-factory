'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AuthClientError, logout } from '@/api/auth-client';

import styles from './auth.module.css';

const FALLBACK_ERROR_MESSAGE = 'Unable to sign out. Please try again.';

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof AuthClientError)) return FALLBACK_ERROR_MESSAGE;
  const message = error.message.trim();
  return message.length > 0 && message.length <= 300 ? message : FALLBACK_ERROR_MESSAGE;
}

export function LogoutButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const activeController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  async function handleLogout(): Promise<void> {
    if (activeController.current !== null) return;

    const controller = new AbortController();
    activeController.current = controller;
    setErrorMessage('');
    setState('loading');

    try {
      await logout({ signal: controller.signal });
      if (controller.signal.aborted) return;
      router.replace('/login');
      router.refresh();
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(safeErrorMessage(error));
        setState('error');
      }
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }

  return (
    <div className={styles.logoutControl}>
      <button
        className={styles.secondaryButton}
        type="button"
        onClick={() => void handleLogout()}
        disabled={state === 'loading'}
      >
        {state === 'loading' ? 'Signing out…' : 'Sign out'}
      </button>
      {state === 'error' ? (
        <span className={styles.logoutError} role="alert">
          {errorMessage}
        </span>
      ) : null}
    </div>
  );
}

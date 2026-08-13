'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ExecutionRerunClientError, rerunExecutionCacheOnly } from '@/api/execution-rerun-client';

import styles from './factory.module.css';

interface ExecutionRerunControlProps {
  readonly executionId: string;
  readonly eligible: boolean;
}

export function ExecutionRerunControl({ executionId, eligible }: ExecutionRerunControlProps) {
  const router = useRouter();
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<
    | { readonly status: 'idle' }
    | { readonly status: 'submitting' }
    | { readonly status: 'error'; readonly message: string }
  >({ status: 'idle' });

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  if (!eligible) return null;

  async function rerun(): Promise<void> {
    // The ref changes synchronously, unlike React state, and closes the same-tick double-click gap.
    if (controller.current !== null || state.status === 'submitting') return;
    const requestController = new AbortController();
    controller.current = requestController;
    setState({ status: 'submitting' });
    try {
      const accepted = await rerunExecutionCacheOnly(executionId, {
        signal: requestController.signal,
      });
      if (!requestController.signal.aborted) {
        router.push(`/executions/${encodeURIComponent(accepted.executionId)}/factory`);
      }
    } catch (error) {
      if (requestController.signal.aborted) return;
      const message =
        error instanceof ExecutionRerunClientError
          ? error.message
          : 'The cache-only rerun could not be started.';
      setState({ status: 'error', message });
    } finally {
      if (controller.current === requestController) controller.current = null;
    }
  }

  return (
    <section className={styles.rerunControl} aria-labelledby="rerun-control-title">
      <span>
        <strong id="rerun-control-title">Replay this execution without OpenAI</strong>
        <small>
          Uses the saved request and exact cached responses. A cache miss stops before any paid
          model call.
        </small>
      </span>
      <button
        className={styles.reloadButton}
        type="button"
        disabled={state.status === 'submitting'}
        onClick={() => void rerun()}
      >
        {state.status === 'submitting' ? 'Scheduling replay…' : 'Rerun cache-only'}
      </button>
      {state.status === 'error' ? <p role="alert">{state.message}</p> : null}
    </section>
  );
}

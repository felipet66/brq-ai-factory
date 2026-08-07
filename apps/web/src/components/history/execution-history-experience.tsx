'use client';

import { useEffect, useState } from 'react';

import { ExecutionHistoryClientError, listExecutions } from '@/api/execution-history-client';
import type { ExecutionHistoryPage } from '@/api/execution-history-contracts';

import { ExecutionHistoryList } from './execution-history-list';
import { HistoryEmptyState, HistoryErrorState, HistoryLoadingState } from './history-state';
import styles from './history.module.css';

const PAGE_SIZE = 20;

type HistoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'success'; readonly page: ExecutionHistoryPage }
  | { readonly status: 'error'; readonly message: string };

function safeErrorMessage(error: unknown): string {
  return error instanceof ExecutionHistoryClientError
    ? error.message
    : 'The execution history service could not process this request.';
}

export function ExecutionHistoryExperience() {
  const [cursor, setCursor] = useState<string | undefined>();
  const [state, setState] = useState<HistoryState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void listExecutions(
      { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      { signal: controller.signal },
    ).then(
      (page) => setState({ status: 'success', page }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', message: safeErrorMessage(error) });
        }
      },
    );

    return () => controller.abort();
  }, [cursor]);

  return (
    <main className={styles.shell} lang="en">
      <div className={styles.layout}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Execution repository</p>
          <h1>Execution History</h1>
          <p>
            Inspect persisted workflow status, readiness and observability metadata without exposing
            prompts, model responses or generated artifacts.
          </p>
        </header>

        {state.status === 'loading' ? (
          <HistoryLoadingState label="Loading execution history…" />
        ) : state.status === 'error' ? (
          <HistoryErrorState message={state.message} />
        ) : state.page.items.length === 0 ? (
          <HistoryEmptyState />
        ) : (
          <ExecutionHistoryList
            items={state.page.items}
            hasNextPage={state.page.nextCursor !== null}
            loadingNextPage={false}
            onNextPage={() => {
              if (state.page.nextCursor !== null) {
                setState({ status: 'loading' });
                setCursor(state.page.nextCursor);
              }
            }}
          />
        )}
      </div>
    </main>
  );
}

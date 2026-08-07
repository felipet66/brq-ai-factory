'use client';

import { useEffect, useState } from 'react';

import {
  ExecutionHistoryClientError,
  getExecution,
  getExecutionTimeline,
} from '@/api/execution-history-client';
import type { ExecutionHistoryDetailView } from '@/api/execution-history-contracts';

import { ExecutionHistoryDetail } from './execution-history-detail';
import { ExecutionHistoryTimeline } from './execution-history-timeline';
import { HistoryErrorState, HistoryLoadingState } from './history-state';
import styles from './history.module.css';

interface ExecutionHistoryDetailExperienceProps {
  readonly executionId: string;
}

type DetailState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'success';
      readonly executionId: string;
      readonly value: ExecutionHistoryDetailView;
    }
  | { readonly status: 'error'; readonly executionId: string; readonly message: string };

function safeErrorMessage(error: unknown): string {
  return error instanceof ExecutionHistoryClientError
    ? error.message
    : 'The execution history service could not process this request.';
}

export function ExecutionHistoryDetailExperience({
  executionId,
}: ExecutionHistoryDetailExperienceProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getExecution(executionId, { signal: controller.signal }),
      getExecutionTimeline(executionId, { signal: controller.signal }),
    ]).then(
      ([execution, timeline]) =>
        setState({
          status: 'success',
          executionId,
          value: { execution, timeline },
        }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            executionId,
            message: safeErrorMessage(error),
          });
        }
      },
    );

    return () => controller.abort();
  }, [executionId]);

  const visibleState =
    state.status !== 'loading' && state.executionId !== executionId
      ? ({ status: 'loading' } as const)
      : state;

  return (
    <main className={styles.shell} lang="en">
      <div className={styles.layout}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Execution repository</p>
          <h1>Execution Detail</h1>
          <p>Inspect persisted lifecycle, hashes, lineage, provenance and stage metrics.</p>
        </header>

        {visibleState.status === 'loading' ? (
          <HistoryLoadingState label="Loading execution details…" />
        ) : visibleState.status === 'error' ? (
          <HistoryErrorState message={visibleState.message} />
        ) : (
          <>
            <ExecutionHistoryDetail execution={visibleState.value.execution} />
            <ExecutionHistoryTimeline timeline={visibleState.value.timeline} />
          </>
        )}
      </div>
    </main>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

import {
  ExecutionTechnicalResumeClientError,
  getExecutionTechnicalResumeState,
  resumeExecutionTechnicalPipeline,
  type ExecutionTechnicalResumeResult,
  type ExecutionTechnicalResumeState,
} from '@/api/execution-technical-resume-client';

import styles from './factory.module.css';

interface TechnicalResumeControlProps {
  readonly executionId: string;
  readonly eligible: boolean;
}

type State =
  | { readonly status: 'idle' }
  | { readonly status: 'submitting' }
  | { readonly status: 'completed'; readonly result: ExecutionTechnicalResumeResult }
  | { readonly status: 'error'; readonly message: string; readonly code: string };

type LookupState =
  | { readonly status: 'loading'; readonly executionId: string }
  | {
      readonly status: 'loaded';
      readonly executionId: string;
      readonly value: ExecutionTechnicalResumeState;
    }
  | { readonly status: 'error'; readonly executionId: string };

const BLOCKING_RESUME_ERROR_CODES = new Set([
  'EXECUTION_TECHNICAL_ATTEMPT_CONFLICT',
  'EXECUTION_TECHNICAL_COMPLETION_PENDING',
  'EXECUTION_TECHNICAL_RECOVERY_REQUIRED',
]);

export function TechnicalResumeControl({ executionId, eligible }: TechnicalResumeControlProps) {
  const resumeController = useRef<AbortController | null>(null);
  const lookupController = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ status: 'idle' });
  const [lookup, setLookup] = useState<LookupState>({ status: 'loading', executionId });

  useEffect(() => {
    if (!eligible) return;
    const requestController = new AbortController();
    lookupController.current?.abort();
    lookupController.current = requestController;
    void getExecutionTechnicalResumeState(executionId, {
      signal: requestController.signal,
    })
      .then((value) => {
        if (!requestController.signal.aborted) {
          setLookup({ status: 'loaded', executionId, value });
        }
      })
      .catch(() => {
        if (!requestController.signal.aborted) setLookup({ status: 'error', executionId });
      })
      .finally(() => {
        if (lookupController.current === requestController) lookupController.current = null;
      });
    return () => requestController.abort();
  }, [eligible, executionId]);

  useEffect(() => {
    return () => {
      resumeController.current?.abort();
      lookupController.current?.abort();
    };
  }, []);

  if (!eligible) return null;

  async function resume(): Promise<void> {
    const currentLookup = lookup.executionId === executionId ? lookup : null;
    if (
      resumeController.current !== null ||
      state.status === 'submitting' ||
      currentLookup?.status !== 'loaded' ||
      currentLookup.value.checkpointStatus !== 'AVAILABLE'
    ) {
      return;
    }
    const requestController = new AbortController();
    resumeController.current = requestController;
    setState({ status: 'submitting' });
    try {
      const result = await resumeExecutionTechnicalPipeline(executionId, {
        signal: requestController.signal,
      });
      if (requestController.signal.aborted) return;

      let confirmedResult = result;
      setLookup({ status: 'loading', executionId });
      try {
        const value = await getExecutionTechnicalResumeState(executionId, {
          signal: requestController.signal,
        });
        if (!requestController.signal.aborted) {
          setLookup({ status: 'loaded', executionId, value });
          if (
            result.status === 'COMPLETION_PENDING' &&
            value.attempt?.attemptId === result.attemptId &&
            value.attempt.activePhase === null &&
            value.attempt.status !== 'RUNNING'
          ) {
            confirmedResult = { ...result, status: value.attempt.status };
          }
        }
      } catch {
        if (!requestController.signal.aborted) setLookup({ status: 'error', executionId });
      }
      if (!requestController.signal.aborted) {
        setState({ status: 'completed', result: confirmedResult });
      }
    } catch (error) {
      if (requestController.signal.aborted) return;
      const clientError = error instanceof ExecutionTechnicalResumeClientError ? error : null;
      if (
        clientError !== null &&
        (clientError.code === 'EXECUTION_TECHNICAL_CLEANUP_PENDING' ||
          clientError.code === 'EXECUTION_TECHNICAL_CLEANUP_FAILED')
      ) {
        setLookup({
          status: 'loaded',
          executionId,
          value: {
            ...currentLookup.value,
            checkpointStatus:
              clientError.code === 'EXECUTION_TECHNICAL_CLEANUP_FAILED'
                ? 'CLEANUP_FAILED'
                : 'CLEANUP_PENDING',
          },
        });
      }
      if (clientError !== null && BLOCKING_RESUME_ERROR_CODES.has(clientError.code)) {
        try {
          const value = await getExecutionTechnicalResumeState(executionId, {
            signal: requestController.signal,
          });
          if (!requestController.signal.aborted) {
            setLookup({ status: 'loaded', executionId, value });
          }
        } catch {
          // The blocking POST result remains authoritative when the lookup is unavailable.
        }
      }
      setState(
        clientError !== null
          ? { status: 'error', message: clientError.message, code: clientError.code }
          : {
              status: 'error',
              message: 'The technical pipeline could not be resumed.',
              code: 'UNKNOWN',
            },
      );
    } finally {
      if (resumeController.current === requestController) resumeController.current = null;
    }
  }

  const currentLookup = lookup.executionId === executionId ? lookup : null;
  if (currentLookup === null || currentLookup.status === 'loading') {
    return (
      <section className={styles.rerunControl} aria-live="polite">
        <span>
          <strong>Checking technical checkpoint…</strong>
          <small>The resume action remains unavailable until persisted evidence is verified.</small>
        </span>
      </section>
    );
  }
  if (currentLookup.status === 'error') {
    return (
      <section className={styles.rerunControl} aria-live="polite">
        <span>
          <strong>Technical checkpoint unavailable</strong>
          <small role="alert">
            The persisted checkpoint state could not be verified. Resume remains blocked.
          </small>
        </span>
      </section>
    );
  }
  if (currentLookup.value.checkpointStatus === 'NOT_FOUND') return null;

  const completed = state.status === 'completed' ? state.result : null;
  const persisted = currentLookup.value.attempt;
  const checkpointStatus = currentLookup.value.checkpointStatus;
  const activePhase = persisted?.activePhase ?? null;
  const attemptConfirmationMissing =
    completed !== null && persisted?.attemptId !== completed.attemptId;
  const blockingPostError = state.status === 'error' && BLOCKING_RESUME_ERROR_CODES.has(state.code);
  const resumeBlocked =
    checkpointStatus !== 'AVAILABLE' ||
    activePhase !== null ||
    persisted?.status === 'RUNNING' ||
    persisted?.status === 'SUCCESS' ||
    (persisted !== null && activePhase === null && !persisted.cleanupConfirmed) ||
    completed?.status === 'COMPLETION_PENDING' ||
    blockingPostError ||
    attemptConfirmationMissing;
  return (
    <section className={styles.rerunControl} aria-labelledby="technical-resume-title">
      <span>
        <strong id="technical-resume-title">Resume the technical pipeline — 0 OpenAI</strong>
        <small>
          Reuses the validated code checkpoint and runs only Workspace and Sandbox as a separate,
          auditable attempt. The original result remains immutable.
        </small>
      </span>
      <button
        className={styles.reloadButton}
        type="button"
        disabled={state.status === 'submitting' || resumeBlocked}
        onClick={() => void resume()}
      >
        {state.status === 'submitting' ? 'Running technical checks…' : 'Resume without AI'}
      </button>
      {completed === null ? null : (
        <p
          role={
            completed.status === 'FAILED' || completed.status === 'CANCELLED' ? 'alert' : 'status'
          }
        >
          {completed.status === 'COMPLETION_PENDING'
            ? 'Technical execution completed and its result was durably recorded. Final confirmation is pending.'
            : `Technical attempt ${completed.status.toLowerCase()}.`}{' '}
          OpenAI used: no. Attempt: <code>{completed.attemptId}</code>
        </p>
      )}
      {completed !== null || persisted === null ? null : (
        <p
          role={
            persisted.status === 'SUCCESS' ||
            activePhase === 'EXECUTING' ||
            activePhase === 'COMPLETION_PENDING'
              ? 'status'
              : 'alert'
          }
        >
          Latest technical attempt {persisted.status.toLowerCase()}. OpenAI used: no. Attempt:{' '}
          <code>{persisted.attemptId}</code>
          {persisted.reasonCode === null ? null : (
            <>
              {' '}
              Reason: <code>{persisted.reasonCode}</code>
            </>
          )}
        </p>
      )}
      {activePhase === 'EXECUTING' ? (
        <p role="status">
          A technical attempt is active. A second attempt remains blocked until it finishes.
        </p>
      ) : null}
      {activePhase === 'COMPLETION_PENDING' ? (
        <p role="status">
          The technical result is durably recorded and awaits final confirmation. A new attempt is
          blocked.
        </p>
      ) : null}
      {activePhase === 'RECOVERY_REQUIRED' ? (
        <p role="alert">
          The previous technical attempt requires safe recovery before another attempt can start.
          {persisted === null || persisted.reasonCode === null ? null : (
            <>
              {' '}
              Reason: <code>{persisted.reasonCode}</code>
            </>
          )}
        </p>
      ) : null}
      {persisted !== null && activePhase === null && !persisted.cleanupConfirmed ? (
        <p role="alert">
          Cleanup was not confirmed for the latest technical attempt. A new attempt is blocked.
        </p>
      ) : null}
      {checkpointStatus === 'CLEANUP_PENDING' ? (
        <p role="alert">
          Cleanup confirmation for the source execution is still pending. Resume remains blocked.
        </p>
      ) : null}
      {checkpointStatus === 'CLEANUP_FAILED' ? (
        <p role="alert">
          Cleanup failed for the source execution. Resume remains blocked until it is resolved.
        </p>
      ) : null}
      {attemptConfirmationMissing ? (
        <p role="alert">
          The latest technical attempt has not been confirmed by persisted state. Resume remains
          blocked.
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert">
          {state.message} <code>{state.code}</code>
        </p>
      ) : null}
    </section>
  );
}

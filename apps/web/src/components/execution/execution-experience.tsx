'use client';

import { useEffect, useRef, useState } from 'react';

import { executeWorkflow } from '@/api/execution-client';
import type { ExecutionSummary } from '@/api/execution-contracts';

import { ErrorState } from './error-state';
import { ExecutionForm, type ExecutionFormValues } from './execution-form';
import { ExecutionResult } from './execution-result';
import { LoadingState } from './loading-state';

type ExecutionViewState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading';
      readonly observability: ExecutionSummary['observability'];
    }
  | { readonly status: 'success'; readonly result: ExecutionSummary }
  | {
      readonly status: 'error';
      readonly message: string;
      readonly observability: ExecutionSummary['observability'];
    };

const FALLBACK_ERROR_MESSAGE = 'The execution service could not process this request.';

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.name !== 'ExecutionClientError') {
    return FALLBACK_ERROR_MESSAGE;
  }
  const message = error.message.trim();
  return message.length > 0 && message.length <= 300 ? message : FALLBACK_ERROR_MESSAGE;
}

function statusAnnouncement(state: ExecutionViewState): string {
  if (state.status === 'idle') return 'Ready to start a workflow.';
  if (state.status === 'error') return '';
  if (state.status === 'success') return `Workflow complete. Status ${state.result.status}.`;

  const activeStage = state.observability?.stages.find((stage) => stage.status === 'RUNNING');
  return activeStage === undefined
    ? 'Executing workflow. Waiting for execution metadata.'
    : `Executing workflow. ${activeStage.stageName} is in progress.`;
}

export function ExecutionExperience() {
  const [state, setState] = useState<ExecutionViewState>({ status: 'idle' });
  const inFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const latestObservability = useRef<ExecutionSummary['observability']>(null);

  useEffect(
    () => () => {
      activeController.current?.abort();
    },
    [],
  );

  async function handleSubmit(values: ExecutionFormValues): Promise<void> {
    if (inFlight.current) return;

    inFlight.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    latestObservability.current = null;
    setState({ status: 'loading', observability: null });

    try {
      const result = await executeWorkflow(values, {
        signal: controller.signal,
        onObservability: (observability) => {
          if (controller.signal.aborted) return;
          latestObservability.current = observability;
          setState((current) =>
            current.status === 'loading' ? { status: 'loading', observability } : current,
          );
        },
      });
      if (!controller.signal.aborted) setState({ status: 'success', result });
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          status: 'error',
          message: safeErrorMessage(error),
          observability: latestObservability.current,
        });
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        inFlight.current = false;
      }
    }
  }

  return (
    <section className="execution-experience" aria-labelledby="execution-form-heading">
      <div className="execution-experience__intro">
        <p className="eyebrow">Human request → specialized agents</p>
        <h2 id="execution-form-heading">Start a workflow</h2>
        <p>Describe the project and the outcome the AI Factory should prepare.</p>
      </div>

      <ExecutionForm loading={state.status === 'loading'} onSubmit={handleSubmit} />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement(state)}
      </p>

      <div className="execution-output" aria-busy={state.status === 'loading'}>
        {state.status === 'idle' ? (
          <p className="execution-state execution-state--idle">
            Ready to coordinate Product Owner, Developer and QA.
          </p>
        ) : null}
        {state.status === 'loading' ? <LoadingState observability={state.observability} /> : null}
        {state.status === 'success' ? <ExecutionResult result={state.result} /> : null}
        {state.status === 'error' ? (
          <ErrorState message={state.message} observability={state.observability} />
        ) : null}
      </div>
    </section>
  );
}

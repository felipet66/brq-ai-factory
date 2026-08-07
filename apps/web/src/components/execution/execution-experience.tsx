'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { executeWorkflow } from '@/api/execution-client';
import type { ExecutionJobView } from '@/api/execution-contracts';

import { ErrorState } from './error-state';
import { ExecutionForm, type ExecutionFormValues } from './execution-form';
import { LoadingState } from './loading-state';

type ExecutionViewState =
  | { readonly status: 'idle' }
  | { readonly status: 'active'; readonly job: ExecutionJobView | null }
  | { readonly status: 'error'; readonly message: string; readonly job: ExecutionJobView | null };

const FALLBACK_ERROR_MESSAGE = 'The execution service could not process this request.';
const FAILED_MESSAGE = 'The workflow finished with a failure.';
const CANCELLED_MESSAGE = 'The workflow was cancelled.';

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
  if (state.job === null || state.job.status === 'QUEUED') return 'Workflow queued.';
  if (state.job.status === 'RUNNING') return 'Workflow running.';
  if (state.job.status === 'SUCCESS') return 'Workflow complete. Opening execution details.';
  return '';
}

export function ExecutionExperience() {
  const router = useRouter();
  const [state, setState] = useState<ExecutionViewState>({ status: 'idle' });
  const inFlight = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const latestJob = useRef<ExecutionJobView | null>(null);

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
    latestJob.current = null;
    setState({ status: 'active', job: null });

    try {
      const job = await executeWorkflow(values, {
        signal: controller.signal,
        onJobUpdate: (update) => {
          if (controller.signal.aborted) return;
          latestJob.current = update;
          setState((current) =>
            current.status === 'active' ? { status: 'active', job: update } : current,
          );
        },
      });
      if (controller.signal.aborted) return;

      latestJob.current = job;
      if (job.status === 'SUCCESS') {
        setState({ status: 'active', job });
        router.push(`/executions/${encodeURIComponent(job.executionId)}`);
        return;
      }
      setState({
        status: 'error',
        message: job.status === 'CANCELLED' ? CANCELLED_MESSAGE : FAILED_MESSAGE,
        job,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setState({
          status: 'error',
          message: safeErrorMessage(error),
          job: latestJob.current,
        });
      }
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

      <ExecutionForm loading={state.status === 'active'} onSubmit={handleSubmit} />

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusAnnouncement(state)}
      </p>

      <div className="execution-output" aria-busy={state.status === 'active'}>
        {state.status === 'idle' ? (
          <p className="execution-state execution-state--idle">
            Ready to coordinate Product Owner, Developer and QA.
          </p>
        ) : null}
        {state.status === 'active' ? <LoadingState job={state.job} /> : null}
        {state.status === 'error' ? <ErrorState message={state.message} job={state.job} /> : null}
      </div>
    </section>
  );
}

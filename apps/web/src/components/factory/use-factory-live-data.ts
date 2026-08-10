'use client';

import { useCallback, useEffect, useState } from 'react';

import { EXECUTION_POLL_INTERVAL_MS, ExecutionClientError, getJob } from '@/api/execution-client';
import type { ExecutionJobView } from '@/api/execution-contracts';
import {
  ExecutionHistoryClientError,
  getExecution,
  getExecutionTimeline,
} from '@/api/execution-history-client';
import type {
  ExecutionHistoryDetail,
  ExecutionHistoryStatus,
  ExecutionHistoryTimeline,
} from '@/api/execution-history-contracts';

import { createFactoryViewModel, type FactoryViewModel } from './factory-view-model';

export type FactoryLiveDataState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly model: FactoryViewModel;
      readonly updateError: string | null;
    };

const FACTORY_FALLBACK_ERROR = 'The execution metadata service could not load this factory.';
const FACTORY_TERMINAL_RECONCILIATION_NOTICE =
  'Execution metadata is still reconciling; the terminal job status is shown.';

function isTerminalExecution(status: ExecutionHistoryStatus): boolean {
  return status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
}

function isTerminalJob(status: ExecutionJobView['status']): boolean {
  return status === 'SUCCESS' || status === 'FAILED' || status === 'CANCELLED';
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof ExecutionHistoryClientError || error instanceof ExecutionClientError) &&
    error.code === 'REQUEST_ABORTED'
  );
}

function isTimelineNotReady(error: unknown): boolean {
  return error instanceof ExecutionHistoryClientError && error.status === 404;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ExecutionHistoryClientError || error instanceof ExecutionClientError) {
    const message = error.message.trim();
    return message.length > 0 && message.length <= 300 ? message : FACTORY_FALLBACK_ERROR;
  }
  return FACTORY_FALLBACK_ERROR;
}

type JobEvidence = Pick<
  ExecutionJobView,
  'jobId' | 'status' | 'queuedAt' | 'startedAt' | 'finishedAt'
>;

function executionStatusFromJob(job: Pick<JobEvidence, 'status'>): ExecutionHistoryStatus {
  return job.status === 'QUEUED' ? 'CREATED' : job.status;
}

function mergeJob(
  execution: ExecutionHistoryDetail,
  job: JobEvidence,
  status: ExecutionHistoryStatus = executionStatusFromJob(job),
): ExecutionHistoryDetail {
  const queuedAt = job.queuedAt ?? execution.job?.queuedAt;
  if (queuedAt === null || queuedAt === undefined) {
    throw new TypeError('A polled job requires its persisted queue timestamp.');
  }
  return Object.freeze({
    ...execution,
    status,
    startedAt: execution.startedAt ?? job.startedAt,
    finishedAt: execution.finishedAt ?? job.finishedAt,
    job: Object.freeze({ ...job, queuedAt }),
  });
}

export function useFactoryLiveData(executionId: string) {
  const [reloadVersion, setReloadVersion] = useState(0);
  const [state, setState] = useState<FactoryLiveDataState>({ status: 'loading' });

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;
    let stopped = false;
    let hasPublished = false;
    let execution: ExecutionHistoryDetail | null = null;
    let timeline: ExecutionHistoryTimeline | null = null;

    function publish(updateError: string | null = null): void {
      if (stopped || execution === null) return;
      hasPublished = true;
      setState({
        status: 'ready',
        model: createFactoryViewModel({ execution, timeline }),
        updateError,
      });
    }

    function fail(error: unknown): void {
      if (stopped || isAbort(error)) return;
      const message = safeErrorMessage(error);
      if (hasPublished) publish(message);
      else setState({ status: 'error', message });
    }

    function schedule(next: () => Promise<void>): void {
      if (stopped) return;
      timer = window.setTimeout(() => {
        timer = null;
        if (document.visibilityState === 'hidden') {
          schedule(next);
          return;
        }
        void next();
      }, EXECUTION_POLL_INTERVAL_MS);
    }

    async function loadOptionalTimeline(): Promise<ExecutionHistoryTimeline | null> {
      try {
        return await getExecutionTimeline(executionId, { signal: controller.signal });
      } catch (error) {
        if (isTimelineNotReady(error)) return null;
        throw error;
      }
    }

    async function finalize(): Promise<void> {
      execution = await getExecution(executionId, { signal: controller.signal });
      timeline = (await loadOptionalTimeline()) ?? timeline;
      if (isTerminalExecution(execution.status)) {
        publish();
        return;
      }
      if (execution.job !== null && isTerminalJob(execution.job.status)) {
        execution = mergeJob(execution, execution.job);
        publish(FACTORY_TERMINAL_RECONCILIATION_NOTICE);
        return;
      }
      if (execution.job === null) {
        publish();
        return;
      }

      const job = await getJob(execution.job.jobId, { signal: controller.signal });
      if (job.executionId !== executionId) {
        throw new TypeError('The job does not belong to the requested execution.');
      }
      execution = mergeJob(execution, job);
      if (isTerminalJob(job.status)) {
        publish(FACTORY_TERMINAL_RECONCILIATION_NOTICE);
        return;
      }

      publish();
      if (job.status === 'QUEUED') schedule(pollJob);
      else schedule(pollTimeline);
    }

    async function settleTerminalJob(job: JobEvidence): Promise<void> {
      if (execution === null) return;
      const fallback = mergeJob(execution, job);
      execution = fallback;

      if (job.status !== 'SUCCESS') {
        publish(FACTORY_TERMINAL_RECONCILIATION_NOTICE);
        return;
      }

      publish(FACTORY_TERMINAL_RECONCILIATION_NOTICE);
      try {
        const refreshedExecution = await getExecution(executionId, {
          signal: controller.signal,
        });
        const refreshedTimeline = await loadOptionalTimeline();
        if (
          refreshedTimeline !== null &&
          (timeline === null || refreshedTimeline.revision > timeline.revision)
        ) {
          timeline = refreshedTimeline;
        }
        execution = isTerminalExecution(refreshedExecution.status)
          ? mergeJob(refreshedExecution, job, refreshedExecution.status)
          : mergeJob(refreshedExecution, job);
        publish(
          isTerminalExecution(refreshedExecution.status)
            ? null
            : FACTORY_TERMINAL_RECONCILIATION_NOTICE,
        );
      } catch (error) {
        fail(error);
      }
    }

    async function pollTimeline(knownJob?: ExecutionJobView): Promise<void> {
      if (stopped) return;
      try {
        if (execution?.job !== null && execution?.job !== undefined) {
          const job =
            knownJob ?? (await getJob(execution.job.jobId, { signal: controller.signal }));
          if (job.executionId !== executionId) {
            throw new TypeError('The job does not belong to the requested execution.');
          }
          if (isTerminalJob(job.status)) {
            await settleTerminalJob(job);
            return;
          }
          execution = mergeJob(execution, job);
          publish();
          if (job.status === 'QUEUED') {
            schedule(pollJob);
            return;
          }
        }

        const nextTimeline = await loadOptionalTimeline();
        if (nextTimeline === null) {
          publish();
          schedule(pollTimeline);
          return;
        }
        if (timeline === null || nextTimeline.revision > timeline.revision) timeline = nextTimeline;
        publish();
        if (nextTimeline.status === 'RUNNING') schedule(pollTimeline);
        else await finalize();
      } catch (error) {
        fail(error);
      }
    }

    async function pollJob(): Promise<void> {
      if (stopped || execution?.job === null || execution?.job === undefined) return;
      try {
        const job = await getJob(execution.job.jobId, { signal: controller.signal });
        if (job.executionId !== executionId) {
          throw new TypeError('The job does not belong to the requested execution.');
        }
        if (isTerminalJob(job.status)) {
          await settleTerminalJob(job);
          return;
        }
        execution = mergeJob(execution, job);
        publish();
        if (job.status === 'QUEUED') schedule(pollJob);
        else await pollTimeline(job);
      } catch (error) {
        fail(error);
      }
    }

    async function pollExecution(): Promise<void> {
      if (stopped) return;
      try {
        execution = await getExecution(executionId, { signal: controller.signal });
        publish();
        if (isTerminalExecution(execution.status)) {
          timeline = await loadOptionalTimeline();
          publish();
        } else if (execution.job !== null && isTerminalJob(execution.job.status)) {
          await settleTerminalJob(execution.job);
        } else if (execution.job !== null) {
          await pollJob();
        } else if (execution.status === 'RUNNING') {
          await pollTimeline();
        } else {
          schedule(pollExecution);
        }
      } catch (error) {
        fail(error);
      }
    }

    async function start(): Promise<void> {
      try {
        execution = await getExecution(executionId, { signal: controller.signal });
        if (isTerminalExecution(execution.status)) {
          timeline = await loadOptionalTimeline();
          publish();
          return;
        }
        publish();
        if (execution.job !== null && isTerminalJob(execution.job.status))
          await settleTerminalJob(execution.job);
        else if (execution.job?.status === 'QUEUED') schedule(pollJob);
        else if (execution.job?.status === 'RUNNING' || execution.status === 'RUNNING')
          await pollTimeline();
        else schedule(pollExecution);
      } catch (error) {
        fail(error);
      }
    }

    void start();

    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [executionId, reloadVersion]);

  return Object.freeze({ state, reload });
}

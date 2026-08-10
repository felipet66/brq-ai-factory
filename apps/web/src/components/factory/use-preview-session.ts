'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getExecutionPreview,
  getPreviewSession,
  PreviewClientError,
  startExecutionPreview,
  stopPreviewSession,
} from '@/api/preview-client';
import type { ExecutionPreviewControl, PreviewSessionView } from '@/api/preview-contracts';

const PREVIEW_POLL_INTERVAL_MS = 750;
const PREVIEW_RUNNING_POLL_INTERVAL_MS = 5_000;
const FALLBACK_ERROR = 'The Preview service is unavailable.';

export type PreviewControlState =
  | { readonly status: 'disabled' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly control: ExecutionPreviewControl;
      readonly action: 'NONE' | 'STARTING' | 'STOPPING';
      readonly actionError: string | null;
    };

function safeMessage(error: unknown): string {
  if (error instanceof PreviewClientError) {
    const message = error.message.trim();
    if (message.length > 0 && message.length <= 300) return message;
  }
  return FALLBACK_ERROR;
}

function pollingDelay(session: PreviewSessionView | null): number | null {
  if (session?.status === 'RUNNING') return PREVIEW_RUNNING_POLL_INTERVAL_MS;
  if (
    session?.status === 'CREATED' ||
    session?.status === 'STARTING' ||
    session?.status === 'STOPPING'
  ) {
    return PREVIEW_POLL_INTERVAL_MS;
  }
  return null;
}

export function usePreviewSession(executionId: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<PreviewControlState>(
    enabled ? { status: 'loading' } : { status: 'disabled' },
  );

  const reload = useCallback(() => {
    if (!enabled) return;
    setState({ status: 'loading' });
    setRevision((value) => value + 1);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setState({ status: 'disabled' });
      });
      return () => {
        cancelled = true;
      };
    }
    const controller = new AbortController();
    let stopped = false;
    let timer: number | null = null;

    function publish(control: ExecutionPreviewControl): void {
      if (!stopped) setState({ status: 'ready', control, action: 'NONE', actionError: null });
    }

    async function load(): Promise<void> {
      try {
        const control = await getExecutionPreview(executionId, { signal: controller.signal });
        publish(control);
        const delay = pollingDelay(control.session);
        if (delay !== null && !stopped) {
          timer = window.setTimeout(() => void load(), delay);
        }
      } catch (error) {
        if (
          !stopped &&
          !(error instanceof PreviewClientError && error.code === 'REQUEST_ABORTED')
        ) {
          setState({ status: 'error', message: safeMessage(error) });
        }
      }
    }

    void load();
    return () => {
      stopped = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, executionId, revision]);

  const start = useCallback(async () => {
    if (state.status !== 'ready' || state.action !== 'NONE') return;
    setState({ ...state, action: 'STARTING', actionError: null });
    try {
      const session = await startExecutionPreview(executionId);
      setState({
        status: 'ready',
        control: { eligibility: { status: 'ELIGIBLE' }, session },
        action: 'NONE',
        actionError: null,
      });
      setRevision((value) => value + 1);
    } catch (error) {
      setState({ ...state, action: 'NONE', actionError: safeMessage(error) });
    }
  }, [executionId, state]);

  const stop = useCallback(async () => {
    if (state.status !== 'ready' || state.action !== 'NONE' || state.control.session === null)
      return;
    const current = state.control.session;
    setState({ ...state, action: 'STOPPING', actionError: null });
    try {
      const session = await stopPreviewSession(current.previewId);
      setState({
        status: 'ready',
        control: { ...state.control, session },
        action: 'NONE',
        actionError: null,
      });
    } catch (error) {
      setState({ ...state, action: 'NONE', actionError: safeMessage(error) });
    }
  }, [state]);

  const refreshSession = useCallback(async () => {
    if (state.status !== 'ready' || state.control.session === null) return;
    try {
      const session = await getPreviewSession(state.control.session.previewId);
      setState({ ...state, control: { ...state.control, session }, actionError: null });
    } catch (error) {
      setState({ ...state, actionError: safeMessage(error) });
    }
  }, [state]);

  return Object.freeze({ state, start, stop, reload, refreshSession });
}

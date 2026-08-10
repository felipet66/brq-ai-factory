'use client';

import type { PreviewEligibilityStatus, PreviewSessionView } from '@/api/preview-contracts';

import styles from './factory.module.css';
import { usePreviewSession } from './use-preview-session';

interface PreviewControlProps {
  readonly executionId: string;
  readonly factoryApproved: boolean;
}

const ELIGIBILITY_COPY: Readonly<Record<PreviewEligibilityStatus, string>> = Object.freeze({
  ELIGIBLE: 'The verified build can be started in an isolated runtime.',
  FACTORY_RESULT_MISSING: 'Historical execution: no Factory result is available.',
  FACTORY_NOT_SUCCESS: 'Preview requires a successful Factory execution.',
  ARTIFACT_UNAVAILABLE: 'The approved Preview artifact is unavailable or expired.',
  PROFILE_UNSUPPORTED: 'This build does not use the strict web Preview profile.',
});

function remainingMinutes(session: PreviewSessionView): string {
  const remainingMs = Math.max(0, Date.parse(session.expiresAt) - Date.now());
  return `${Math.ceil(remainingMs / 60_000)} min remaining`;
}

export function PreviewControl({ executionId, factoryApproved }: PreviewControlProps) {
  const { state, start, stop, reload } = usePreviewSession(executionId, factoryApproved);

  return (
    <section className={styles.previewControl} aria-labelledby="preview-control-heading">
      <div className={styles.previewHeader}>
        <span>
          <small>Isolated runtime</small>
          <h2 id="preview-control-heading">Build Preview</h2>
        </span>
        <span className={styles.previewBoundary}>Separate origin · temporary · authenticated</span>
      </div>

      {!factoryApproved || state.status === 'disabled' ? (
        <PreviewNotice message="Preview becomes available only after the complete Factory Pipeline succeeds." />
      ) : state.status === 'loading' ? (
        <PreviewNotice message="Checking approved artifact and Preview eligibility…" busy />
      ) : state.status === 'error' ? (
        <div className={styles.previewNotice} role="alert">
          <span>{state.message}</span>
          <button type="button" onClick={reload}>
            Reload Preview state
          </button>
        </div>
      ) : (
        <PreviewReadyState
          eligibility={state.control.eligibility.status}
          session={state.control.session}
          action={state.action}
          actionError={state.actionError}
          onStart={() => void start()}
          onStop={() => void stop()}
        />
      )}
    </section>
  );
}

function PreviewNotice({
  message,
  busy = false,
}: {
  readonly message: string;
  readonly busy?: boolean;
}) {
  return (
    <p className={styles.previewNotice} role="status" aria-live="polite" aria-busy={busy}>
      {message}
    </p>
  );
}

function PreviewReadyState({
  eligibility,
  session,
  action,
  actionError,
  onStart,
  onStop,
}: {
  readonly eligibility: PreviewEligibilityStatus;
  readonly session: PreviewSessionView | null;
  readonly action: 'NONE' | 'STARTING' | 'STOPPING';
  readonly actionError: string | null;
  readonly onStart: () => void;
  readonly onStop: () => void;
}) {
  if (session === null) {
    return (
      <div className={styles.previewBody}>
        <PreviewStatusMark status={eligibility === 'ELIGIBLE' ? 'READY' : 'UNAVAILABLE'} />
        <div>
          <strong>
            {eligibility === 'ELIGIBLE' ? 'Artifact approved' : 'Preview unavailable'}
          </strong>
          <p>{ELIGIBILITY_COPY[eligibility]}</p>
        </div>
        {eligibility === 'ELIGIBLE' ? (
          <button
            className={styles.previewPrimaryAction}
            type="button"
            disabled={action !== 'NONE'}
            onClick={onStart}
          >
            {action === 'STARTING' ? 'Starting…' : 'Start Preview'}
          </button>
        ) : null}
        <PreviewActionError message={actionError} />
      </div>
    );
  }

  const running = session.status === 'RUNNING' && session.health === 'HEALTHY';
  const stoppable = session.status === 'CREATED' || session.status === 'STARTING' || running;
  return (
    <div className={styles.previewBody}>
      <PreviewStatusMark status={session.status} />
      <div className={styles.previewSessionCopy}>
        <strong>{running ? 'Build is live' : `Preview ${session.status.toLowerCase()}`}</strong>
        <p>{running ? remainingMinutes(session) : ELIGIBILITY_COPY[eligibility]}</p>
        <code>{session.previewId}</code>
      </div>
      <div className={styles.previewActions}>
        {running ? (
          <form
            action={`/previews/${encodeURIComponent(session.previewId)}/launch`}
            method="post"
            target="_blank"
          >
            <button className={styles.previewPrimaryAction} type="submit">
              View Build
            </button>
          </form>
        ) : null}
        {stoppable ? (
          <button
            className={styles.previewSecondaryAction}
            type="button"
            disabled={action !== 'NONE'}
            onClick={onStop}
          >
            {action === 'STOPPING' ? 'Stopping…' : 'Stop Preview'}
          </button>
        ) : null}
      </div>
      <PreviewActionError message={actionError} />
    </div>
  );
}

function PreviewStatusMark({ status }: { readonly status: string }) {
  return (
    <span
      className={styles.previewStatusMark}
      data-status={status}
      aria-label={`Preview status ${status}`}
    >
      {status}
    </span>
  );
}

function PreviewActionError({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <p className={styles.previewActionError} role="alert">
      {message}
    </p>
  );
}

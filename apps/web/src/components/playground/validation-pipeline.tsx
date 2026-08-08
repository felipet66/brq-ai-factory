import type {
  PlaygroundValidation,
  PlaygroundValidationStage,
  PlaygroundValidationStatus,
} from '@/api/playground-contracts';

import type { PlaygroundDraft } from './playground-input-form';
import styles from './playground.module.css';

const VALIDATION_STAGES = [
  'RESPONSE_VALIDATOR',
  'JSON_SCHEMA',
  'AGENT_CONTRACT',
  'BUSINESS_VALIDATION',
] as const satisfies readonly PlaygroundValidationStage[];

interface ValidationWorkspaceProps {
  readonly disabled: boolean;
  readonly draft: PlaygroundDraft;
  readonly error: string | null;
  readonly onChange: (draft: PlaygroundDraft) => void;
  readonly onValidate: () => void;
  readonly result: PlaygroundValidation | null;
}

function formatIssuePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return '/';
  return `/${path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
}

export function ValidationWorkspace({
  disabled,
  draft,
  error,
  onChange,
  onValidate,
  result,
}: ValidationWorkspaceProps) {
  const stages =
    result?.stages ??
    VALIDATION_STAGES.map((stage) => ({
      stage,
      status: 'NOT_RUN' as PlaygroundValidationStatus,
      issues: [],
      issuesTruncated: false,
    }));

  return (
    <section className={styles.contentPanel} aria-labelledby="validation-preview-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>No provider call</p>
          <h2 id="validation-preview-heading">Validation preview</h2>
        </div>
        <span>{result?.status ?? 'Not run'}</span>
      </div>
      <p className={styles.supportingText}>
        Paste a representative response or load the safe example, then run the same contract and
        business checks used by the selected agent.
      </p>
      <label className={styles.field}>
        <span>Candidate response</span>
        <textarea
          value={draft.candidate}
          rows={14}
          maxLength={1_048_576}
          spellCheck={false}
          disabled={disabled}
          aria-describedby={error === null ? undefined : 'validation-candidate-error'}
          aria-invalid={error !== null}
          onChange={(event) => onChange({ ...draft, candidate: event.target.value })}
        />
      </label>
      {error === null ? null : (
        <p id="validation-candidate-error" className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.primaryButton}
        disabled={disabled}
        onClick={onValidate}
      >
        {disabled ? 'Validating…' : 'Validate candidate'}
      </button>

      <ol className={styles.validationPipeline} aria-label="Validation stages">
        {stages.map((stage, index) => (
          <li key={stage.stage} data-status={stage.status}>
            <span className={styles.validationSequence} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <div className={styles.validationHeading}>
                <strong>{stage.stage.replaceAll('_', ' ')}</strong>
                <span>{stage.status}</span>
              </div>
              {stage.issues.length === 0 ? null : (
                <ul className={styles.issueList}>
                  {stage.issues.map((issue, issueIndex) => (
                    <li key={`${issue.code}-${formatIssuePath(issue.path)}-${issueIndex}`}>
                      <code>{issue.code}</code>
                      <span>{formatIssuePath(issue.path)}</span>
                      {issue.keyword === null ? null : <span>Keyword: {issue.keyword}</span>}
                      <p>{issue.message}</p>
                    </li>
                  ))}
                </ul>
              )}
              {stage.issuesTruncated ? (
                <p className={styles.inlineWarning}>Additional issues were omitted.</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {result === null ? null : (
        <dl className={styles.validationMetadata}>
          <div>
            <dt>Candidate hash</dt>
            <dd>
              <code>{result.candidateHash}</code>
            </dd>
          </div>
          <div>
            <dt>Contract hash</dt>
            <dd>
              <code>{result.contract.contractHash}</code>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

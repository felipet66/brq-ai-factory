import type {
  JsonValue,
  PlaygroundAgent,
  PlaygroundExample,
  PlaygroundPreviewRequest,
} from '@/api/playground-contracts';

import styles from './playground.module.css';

export interface PlaygroundDraft {
  readonly projectName: string;
  readonly objective: string;
  readonly productOwnerSpecification: string;
  readonly technicalSpecification: string;
  readonly candidate: string;
}

interface PlaygroundInputFormProps {
  readonly agent: PlaygroundAgent;
  readonly disabled: boolean;
  readonly draft: PlaygroundDraft;
  readonly error: string | null;
  readonly example: PlaygroundExample | null;
  readonly onBuild: () => void;
  readonly onChange: (draft: PlaygroundDraft) => void;
  readonly onLoadExample: () => void;
}

export function emptyPlaygroundDraft(): PlaygroundDraft {
  return {
    projectName: '',
    objective: '',
    productOwnerSpecification: '',
    technicalSpecification: '',
    candidate: '',
  };
}

function formatJson(value: JsonValue | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

function jsonObject(value: JsonValue): Readonly<Record<string, JsonValue>> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Readonly<Record<string, JsonValue>>;
}

export function draftFromExample(
  agent: PlaygroundAgent,
  example: PlaygroundExample,
): PlaygroundDraft {
  const base = emptyPlaygroundDraft();
  const input = jsonObject(example.input);
  if (
    agent === 'PRODUCT_OWNER' &&
    input !== null &&
    typeof input.projectName === 'string' &&
    typeof input.objective === 'string'
  ) {
    return {
      ...base,
      projectName: input.projectName,
      objective: input.objective,
      candidate: example.candidate ?? '',
    };
  }
  if (agent === 'DEVELOPER' && input !== null && input.productOwnerSpecification !== undefined) {
    return {
      ...base,
      productOwnerSpecification: formatJson(input.productOwnerSpecification),
      candidate: example.candidate ?? '',
    };
  }
  if (
    agent === 'QA' &&
    input !== null &&
    input.productOwnerSpecification !== undefined &&
    input.technicalSpecification !== undefined
  ) {
    return {
      ...base,
      productOwnerSpecification: formatJson(input.productOwnerSpecification),
      technicalSpecification: formatJson(input.technicalSpecification),
      candidate: example.candidate ?? '',
    };
  }
  return base;
}

function parseObject(value: string, label: string): Record<string, JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`${label} must contain valid JSON.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, JsonValue>;
}

export function requestFromDraft(
  agent: PlaygroundAgent,
  draft: PlaygroundDraft,
): PlaygroundPreviewRequest {
  if (agent === 'PRODUCT_OWNER') {
    const projectName = draft.projectName.trim();
    const objective = draft.objective.trim();
    if (projectName.length === 0 || objective.length === 0) {
      throw new TypeError('Project name and objective are required.');
    }
    return { agent, input: { projectName, objective } };
  }

  const productOwnerSpecification = parseObject(
    draft.productOwnerSpecification,
    'Product Owner specification',
  );
  if (agent === 'DEVELOPER') {
    return { agent, input: { productOwnerSpecification } };
  }
  return {
    agent,
    input: {
      productOwnerSpecification,
      technicalSpecification: parseObject(draft.technicalSpecification, 'Technical specification'),
    },
  };
}

function updateDraft(
  current: PlaygroundDraft,
  key: keyof PlaygroundDraft,
  value: string,
): PlaygroundDraft {
  return { ...current, [key]: value };
}

export function PlaygroundInputForm({
  agent,
  disabled,
  draft,
  error,
  example,
  onBuild,
  onChange,
  onLoadExample,
}: PlaygroundInputFormProps) {
  return (
    <form
      className={styles.inputForm}
      aria-busy={disabled}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onBuild();
      }}
    >
      <div className={styles.panelHeadingCompact}>
        <div>
          <p className={styles.kicker}>Inspection input</p>
          <h2>Build context</h2>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onLoadExample}
          disabled={disabled || example === null}
        >
          Load example
        </button>
      </div>
      <p className={styles.supportingText}>
        {example === null
          ? 'No safe example is available for this agent.'
          : `Example: ${example.label}. ${example.description}`}{' '}
        Inputs remain in memory only.
      </p>

      <fieldset disabled={disabled} className={styles.formFields}>
        <legend className="sr-only">Input for {agent}</legend>
        {agent === 'PRODUCT_OWNER' ? (
          <>
            <label className={styles.field}>
              <span>Project name</span>
              <input
                name="projectName"
                value={draft.projectName}
                maxLength={200}
                required
                onChange={(event) =>
                  onChange(updateDraft(draft, 'projectName', event.target.value))
                }
              />
            </label>
            <label className={styles.field}>
              <span>Objective</span>
              <textarea
                name="objective"
                value={draft.objective}
                maxLength={16_000}
                rows={6}
                required
                onChange={(event) => onChange(updateDraft(draft, 'objective', event.target.value))}
              />
            </label>
          </>
        ) : (
          <>
            <label className={styles.field}>
              <span>Product Owner specification</span>
              <textarea
                name="productOwnerSpecification"
                value={draft.productOwnerSpecification}
                rows={12}
                spellCheck={false}
                required
                onChange={(event) =>
                  onChange(updateDraft(draft, 'productOwnerSpecification', event.target.value))
                }
              />
            </label>
            {agent === 'QA' ? (
              <label className={styles.field}>
                <span>Technical specification</span>
                <textarea
                  name="technicalSpecification"
                  value={draft.technicalSpecification}
                  rows={12}
                  spellCheck={false}
                  required
                  onChange={(event) =>
                    onChange(updateDraft(draft, 'technicalSpecification', event.target.value))
                  }
                />
              </label>
            ) : null}
          </>
        )}
      </fieldset>

      {error === null ? null : (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}
      <button type="submit" className={styles.primaryButton} disabled={disabled}>
        {disabled ? 'Building preview…' : 'Build prompt preview'}
      </button>
    </form>
  );
}

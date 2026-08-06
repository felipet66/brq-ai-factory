import { useState, type FormEvent } from 'react';

export interface ExecutionFormValues {
  readonly projectName: string;
  readonly objective: string;
}

interface ExecutionFormProps {
  readonly loading: boolean;
  readonly onSubmit: (values: ExecutionFormValues) => void | Promise<void>;
}

interface FormErrors {
  readonly projectName: string | null;
  readonly objective: string | null;
}

const PROJECT_NAME_MAX_LENGTH = 200;
const OBJECTIVE_MAX_LENGTH = 16_000;

export function ExecutionForm({ loading, onSubmit }: ExecutionFormProps) {
  const [projectName, setProjectName] = useState('');
  const [objective, setObjective] = useState('');
  const [errors, setErrors] = useState<FormErrors>({ projectName: null, objective: null });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (loading) return;

    const normalizedProjectName = projectName.trim();
    const normalizedObjective = objective.trim();
    const nextErrors: FormErrors = {
      projectName:
        normalizedProjectName.length === 0
          ? 'Project Name cannot contain only spaces.'
          : normalizedProjectName.length > PROJECT_NAME_MAX_LENGTH
            ? `Project Name must contain at most ${PROJECT_NAME_MAX_LENGTH} characters.`
            : null,
      objective:
        normalizedObjective.length === 0
          ? 'Objective cannot contain only spaces.'
          : normalizedObjective.length > OBJECTIVE_MAX_LENGTH
            ? `Objective must contain at most ${OBJECTIVE_MAX_LENGTH} characters.`
            : null,
    };

    setErrors(nextErrors);
    if (nextErrors.projectName !== null || nextErrors.objective !== null) return;

    void onSubmit({ projectName: normalizedProjectName, objective: normalizedObjective });
  }

  return (
    <form className="execution-form" onSubmit={handleSubmit} aria-busy={loading} noValidate>
      <fieldset className="execution-form__fields" disabled={loading}>
        <legend className="sr-only">Workflow request</legend>

        <div className="form-field">
          <div className="form-field__heading">
            <label htmlFor="project-name">Project Name</label>
            <span aria-hidden="true">
              {projectName.length}/{PROJECT_NAME_MAX_LENGTH}
            </span>
          </div>
          <input
            id="project-name"
            name="projectName"
            type="text"
            value={projectName}
            required
            maxLength={PROJECT_NAME_MAX_LENGTH}
            autoComplete="organization"
            aria-describedby={errors.projectName === null ? undefined : 'project-name-error'}
            aria-invalid={errors.projectName !== null}
            onChange={(event) => {
              setProjectName(event.target.value);
              if (errors.projectName !== null) setErrors({ ...errors, projectName: null });
            }}
          />
          {errors.projectName === null ? null : (
            <p id="project-name-error" className="form-field__error">
              {errors.projectName}
            </p>
          )}
        </div>

        <div className="form-field">
          <div className="form-field__heading">
            <label htmlFor="objective">Objective</label>
            <span aria-hidden="true">
              {objective.length}/{OBJECTIVE_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id="objective"
            name="objective"
            value={objective}
            required
            maxLength={OBJECTIVE_MAX_LENGTH}
            rows={7}
            aria-describedby={errors.objective === null ? undefined : 'objective-error'}
            aria-invalid={errors.objective !== null}
            onChange={(event) => {
              setObjective(event.target.value);
              if (errors.objective !== null) setErrors({ ...errors, objective: null });
            }}
          />
          {errors.objective === null ? null : (
            <p id="objective-error" className="form-field__error">
              {errors.objective}
            </p>
          )}
        </div>

        <button type="submit" className="execution-form__submit" disabled={loading}>
          Execute Workflow
        </button>
      </fieldset>
    </form>
  );
}

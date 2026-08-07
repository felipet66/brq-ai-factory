import type { ExecutionJobView } from '@/api/execution-contracts';

import { ExecutionJobProgress } from './execution-job-progress';

interface ErrorStateProps {
  readonly message: string;
  readonly job?: ExecutionJobView | null;
}

export function ErrorState({ message, job = null }: ErrorStateProps) {
  return (
    <div className="execution-error-output">
      <section
        className="execution-state execution-state--error"
        role="alert"
        aria-live="assertive"
      >
        <p className="state-label">Execution error</p>
        <h2>Unable to complete the request</h2>
        <p>{message}</p>
      </section>
      {job === null ? null : <ExecutionJobProgress job={job} />}
    </div>
  );
}

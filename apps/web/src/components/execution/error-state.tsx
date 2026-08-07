import type { ExecutionSummary } from '@/api/execution-contracts';

import { ExecutionTimeline } from './execution-timeline';

interface ErrorStateProps {
  readonly message: string;
  readonly observability?: ExecutionSummary['observability'];
}

export function ErrorState({ message, observability = null }: ErrorStateProps) {
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
      {observability === null ? null : <ExecutionTimeline observability={observability} />}
    </div>
  );
}

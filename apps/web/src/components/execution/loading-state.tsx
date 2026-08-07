import type { ExecutionJobView } from '@/api/execution-contracts';

import { ExecutionJobProgress } from './execution-job-progress';

interface LoadingStateProps {
  readonly job: ExecutionJobView | null;
}

export function LoadingState({ job }: LoadingStateProps) {
  const running = job?.status === 'RUNNING';
  return (
    <div className="execution-state execution-state--loading">
      <div>
        <h2>{running ? 'Executing workflow' : 'Workflow queued'}</h2>
        <p>
          {running
            ? 'Product Owner, Developer and QA are working in sequence.'
            : 'The request is waiting for the local execution worker.'}
        </p>
      </div>
      <ExecutionJobProgress job={job} />
    </div>
  );
}

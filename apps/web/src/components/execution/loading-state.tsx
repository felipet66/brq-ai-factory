import type { ExecutionSummary } from '@/api/execution-contracts';

import { ExecutionTimeline } from './execution-timeline';

interface LoadingStateProps {
  readonly observability: ExecutionSummary['observability'];
}

export function LoadingState({ observability }: LoadingStateProps) {
  return (
    <div className="execution-state execution-state--loading">
      <div>
        <h2>Executing workflow</h2>
        <p>Product Owner, Developer and QA are working in sequence.</p>
      </div>
      <ExecutionTimeline loading observability={observability} />
    </div>
  );
}

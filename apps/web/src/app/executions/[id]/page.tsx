import { ExecutionHistoryDetailExperience } from '@/components/history/execution-history-detail-experience';

interface ExecutionDetailsPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function ExecutionDetailsPage({ params }: ExecutionDetailsPageProps) {
  const { id } = await params;
  return <ExecutionHistoryDetailExperience executionId={id} />;
}

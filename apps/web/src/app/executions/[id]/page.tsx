import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { ExecutionHistoryDetailExperience } from '@/components/history/execution-history-detail-experience';
import { requireAuthenticatedUser } from '@/server/auth/session';

interface ExecutionDetailsPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function ExecutionDetailsPage({ params }: ExecutionDetailsPageProps) {
  const currentUser = await requireAuthenticatedUser();
  const { id } = await params;

  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <ExecutionHistoryDetailExperience executionId={id} />
    </>
  );
}

import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { ExecutionHistoryExperience } from '@/components/history/execution-history-experience';
import { requireAuthenticatedUser } from '@/server/auth/session';

export default async function ExecutionHistoryPage() {
  const currentUser = await requireAuthenticatedUser();

  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <ExecutionHistoryExperience />
    </>
  );
}

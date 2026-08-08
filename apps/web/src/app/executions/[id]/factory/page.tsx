import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { FactoryExperience } from '@/components/factory/factory-experience';
import { requireAuthenticatedUser } from '@/server/auth/session';

interface ExecutionFactoryPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function ExecutionFactoryPage({ params }: ExecutionFactoryPageProps) {
  const currentUser = await requireAuthenticatedUser();
  const { id } = await params;

  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <FactoryExperience executionId={id} canAccessPlayground={currentUser.role === 'ADMIN'} />
    </>
  );
}

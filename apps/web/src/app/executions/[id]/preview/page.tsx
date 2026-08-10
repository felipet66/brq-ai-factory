import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { PreviewExperience } from '@/components/factory/preview-experience';
import { requireAuthenticatedUser } from '@/server/auth/session';

interface ExecutionPreviewPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function ExecutionPreviewPage({ params }: ExecutionPreviewPageProps) {
  const currentUser = await requireAuthenticatedUser();
  const { id } = await params;
  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <PreviewExperience executionId={id} />
    </>
  );
}

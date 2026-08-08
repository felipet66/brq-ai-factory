import { notFound } from 'next/navigation';

import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { PlaygroundExperience } from '@/components/playground/playground-experience';
import { requireAuthenticatedUser } from '@/server/auth/session';

export default async function PlaygroundPage() {
  const currentUser = await requireAuthenticatedUser();
  if (currentUser.role !== 'ADMIN') notFound();

  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <PlaygroundExperience />
    </>
  );
}

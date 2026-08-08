import { AuthenticatedHeader } from '@/components/auth/authenticated-header';
import { ProfileView } from '@/components/auth/profile-view';
import { requireAuthenticatedUser } from '@/server/auth/session';

export default async function ProfilePage() {
  const currentUser = await requireAuthenticatedUser();

  return (
    <>
      <AuthenticatedHeader currentUser={currentUser} />
      <ProfileView currentUser={currentUser} />
    </>
  );
}

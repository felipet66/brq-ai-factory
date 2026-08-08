import Link from 'next/link';

import type { AuthenticatedUser } from '@/api/auth-contracts';

import styles from './auth.module.css';

interface CurrentUserProps {
  readonly currentUser: AuthenticatedUser;
}

export function CurrentUser({ currentUser }: CurrentUserProps) {
  return (
    <Link className={styles.currentUser} href="/profile" aria-label="Open current user profile">
      <span className={styles.currentUserName}>{currentUser.name}</span>
      <span className={styles.currentUserMeta}>
        {currentUser.email} · {currentUser.role}
      </span>
    </Link>
  );
}

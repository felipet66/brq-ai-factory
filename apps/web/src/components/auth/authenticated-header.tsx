import Link from 'next/link';

import type { AuthenticatedUser } from '@/api/auth-contracts';

import styles from './auth.module.css';
import { CurrentUser } from './current-user';
import { LogoutButton } from './logout-button';

interface AuthenticatedHeaderProps {
  readonly currentUser: AuthenticatedUser;
}

export function AuthenticatedHeader({ currentUser }: AuthenticatedHeaderProps) {
  return (
    <header className={styles.applicationHeader}>
      <Link className={styles.brand} href="/">
        BRQ AI Factory
      </Link>
      <nav className={styles.navigation} aria-label="Primary navigation">
        <Link href="/">New execution</Link>
        <Link href="/executions">History</Link>
        {currentUser.role === 'ADMIN' ? <Link href="/playground">Playground</Link> : null}
        <Link href="/profile">Profile</Link>
      </nav>
      <div className={styles.accountControls}>
        <CurrentUser currentUser={currentUser} />
        <LogoutButton />
      </div>
    </header>
  );
}

import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/auth/login-form';
import { getOptionalAuthenticatedUser } from '@/server/auth/session';

import styles from '../../components/auth/auth.module.css';

export default async function LoginPage() {
  const currentUser = await getOptionalAuthenticatedUser();
  if (currentUser !== null) redirect('/');

  return (
    <main className={styles.loginShell} lang="en">
      <div className={styles.loginLayout}>
        <header className={styles.loginHero}>
          <p>Protected AI delivery platform</p>
          <h1>Sign in</h1>
          <span>Use your BRQ AI Factory account to start and inspect your workflows.</span>
        </header>
        <section className={styles.loginPanel} aria-label="Account access">
          <LoginForm />
        </section>
      </div>
    </main>
  );
}

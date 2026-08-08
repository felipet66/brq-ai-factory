import type { AuthenticatedUser } from '@/api/auth-contracts';

import styles from './auth.module.css';

interface ProfileViewProps {
  readonly currentUser: AuthenticatedUser;
}

export function ProfileView({ currentUser }: ProfileViewProps) {
  return (
    <main className={styles.profileShell} lang="en">
      <div className={styles.profileLayout}>
        <header className={styles.profileHero}>
          <p>Authenticated account</p>
          <h1>Profile</h1>
          <span>Review the public identity associated with this session.</span>
        </header>

        <section className={styles.profilePanel} aria-labelledby="profile-details-heading">
          <h2 id="profile-details-heading">Account details</h2>
          <dl className={styles.profileFacts}>
            <div>
              <dt>ID</dt>
              <dd>
                <code>{currentUser.id}</code>
              </dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{currentUser.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{currentUser.email}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{currentUser.role}</dd>
            </div>
            <div>
              <dt>Created at</dt>
              <dd>
                <time dateTime={currentUser.createdAt}>{currentUser.createdAt}</time>
              </dd>
            </div>
            <div>
              <dt>Updated at</dt>
              <dd>
                <time dateTime={currentUser.updatedAt}>{currentUser.updatedAt}</time>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}

'use client';

import Link from 'next/link';

import { PreviewControl } from './preview-control';
import styles from './factory.module.css';

export function PreviewExperience({ executionId }: { readonly executionId: string }) {
  return (
    <main className={styles.shell} lang="en">
      <span className={styles.gridBackdrop} aria-hidden="true" />
      <div className={styles.layout}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Temporary isolated runtime</p>
            <h1>
              Build Preview
              <span>Control plane / no deployment</span>
            </h1>
          </div>
          <nav className={styles.viewNav} aria-label="Execution views">
            <Link
              className={styles.navLink}
              href={`/executions/${encodeURIComponent(executionId)}/factory`}
            >
              Factory View
            </Link>
            <Link
              className={styles.navLink}
              href={`/executions/${encodeURIComponent(executionId)}`}
            >
              Technical Detail
            </Link>
          </nav>
        </header>
        <PreviewControl executionId={executionId} factoryApproved />
      </div>
    </main>
  );
}

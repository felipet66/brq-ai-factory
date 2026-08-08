import type { PlaygroundBuiltPreview } from '@/api/playground-contracts';

import styles from './playground.module.css';

interface TrustBoundariesProps {
  readonly boundaries: PlaygroundBuiltPreview['trustBoundaries'];
  readonly sections: PlaygroundBuiltPreview['sections'];
}

export function TrustBoundaries({ boundaries, sections }: TrustBoundariesProps) {
  return (
    <section className={styles.trustPanel} aria-labelledby="trust-boundaries-heading">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.kicker}>Prompt channels</p>
          <h2 id="trust-boundaries-heading">Trust boundaries</h2>
        </div>
        <span>Derived from contracts</span>
      </div>
      <div className={styles.trustColumns}>
        {(['TRUSTED', 'UNTRUSTED'] as const).map((trust) => (
          <section key={trust} aria-labelledby={`trust-${trust.toLowerCase()}`}>
            <h3 id={`trust-${trust.toLowerCase()}`}>{trust}</h3>
            <ul>
              {(trust === 'TRUSTED'
                ? boundaries.trustedSectionIds
                : boundaries.untrustedSectionIds
              ).map((sectionId) => {
                const section = sections.find(({ id }) => id === sectionId);
                return (
                  <li key={sectionId}>
                    <strong>{section?.kind ?? sectionId}</strong>
                    <span>
                      {section?.channel ?? 'Unknown channel'} · {sectionId}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

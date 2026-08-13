import type { FactoryReadinessTrace as FactoryReadinessTraceModel } from './factory-view-model';
import styles from './factory.module.css';

interface FactoryReadinessTraceProps {
  readonly trace: FactoryReadinessTraceModel;
}

export function FactoryReadinessTrace({ trace }: FactoryReadinessTraceProps) {
  if (trace.steps.length === 0 && trace.outcome === null) return null;

  return (
    <section className={styles.readinessTrace} aria-labelledby="readiness-trace-heading">
      <div className={styles.readinessTraceHeading}>
        <div>
          <small>Contract-derived metadata</small>
          <h2 id="readiness-trace-heading">Readiness path</h2>
        </div>
        <span>No generated content</span>
      </div>
      <ol className={styles.readinessTraceRail}>
        {trace.steps.map((step) => (
          <li key={step.agentId}>
            <strong>{step.agentName}</strong>
            <span>{step.readiness}</span>
            {step.evidence === 'LEGACY_UNKNOWN' ? (
              <small>legacy origin unknown</small>
            ) : (
              <small>
                {step.factors.map((factor) => `${factor.sourceStage} · ${factor.code}`).join(' | ')}
              </small>
            )}
          </li>
        ))}
      </ol>
      {trace.outcome === null ? null : (
        <p className={styles.readinessTraceOutcome} data-kind={trace.outcome.kind}>
          {trace.outcome.kind === 'FACTORY_BLOCKED_BEFORE_CODE_GENERATION'
            ? 'Factory blocked before Code Generation'
            : 'Code Generator rejected source'}
          <strong>{trace.outcome.reasonCode ?? trace.outcome.code}</strong>
        </p>
      )}
    </section>
  );
}

import { formatDuration, shortHash } from './factory-format';
import type { FactoryTechnicalStage } from './factory-view-model';
import styles from './factory.module.css';

interface FactoryTechnicalPipelineProps {
  readonly stages: readonly FactoryTechnicalStage[];
}

export function FactoryTechnicalPipeline({ stages }: FactoryTechnicalPipelineProps) {
  if (stages.length === 0) {
    return (
      <section className={styles.technicalPipeline} aria-labelledby="technical-pipeline-heading">
        <TechnicalPipelineHeading />
        <p className={styles.technicalEmpty}>
          No Factory Pipeline evidence is available for this historical execution.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.technicalPipeline} aria-labelledby="technical-pipeline-heading">
      <TechnicalPipelineHeading />
      <ol className={styles.technicalRail} aria-label="Factory technical pipeline">
        {stages.map((stage, index) => (
          <li className={styles.technicalStation} data-state={stage.status} key={stage.id}>
            <span className={styles.technicalIndex} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className={styles.technicalNode} aria-hidden="true" />
            <div className={styles.technicalStationHeader}>
              <span>
                <small>{stage.group}</small>
                <strong>{stage.name}</strong>
              </span>
              <span className={styles.technicalStatus}>{stage.status}</span>
            </div>
            <dl className={styles.technicalMetrics}>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(stage.durationMs)}</dd>
              </div>
              <div>
                <dt>Output hash</dt>
                <dd className={styles.mono} title={stage.outputHash ?? undefined}>
                  {shortHash(stage.outputHash)}
                </dd>
              </div>
              {stage.failureCode === null ? null : (
                <div>
                  <dt>Failure</dt>
                  <dd>{stage.failureCode}</dd>
                </div>
              )}
              {stage.reasonCode === null ? null : (
                <div>
                  <dt>Reason</dt>
                  <dd>{stage.reasonCode}</dd>
                </div>
              )}
              {stage.profileRuleId === null ? null : (
                <div>
                  <dt>Profile rule</dt>
                  <dd>{stage.profileRuleId}</dd>
                </div>
              )}
              {stage.diagnosticSummary === null ? null : (
                <>
                  <div>
                    <dt>TypeScript diagnostics</dt>
                    <dd>
                      {stage.diagnosticSummary.diagnosticCount}
                      {stage.diagnosticSummary.truncated ? ' (truncated)' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Diagnostic codes</dt>
                    <dd>
                      {stage.diagnosticSummary.diagnosticCodes.length === 0
                        ? 'Not available'
                        : stage.diagnosticSummary.diagnosticCodes
                            .map((code) => `TS${code}`)
                            .join(', ')}
                    </dd>
                  </div>
                </>
              )}
              {stage.resourceOutcome === null ? null : (
                <div>
                  <dt>Resource</dt>
                  <dd>{stage.resourceOutcome}</dd>
                </div>
              )}
            </dl>
            {stage.facts.length === 0 ? null : (
              <dl className={styles.technicalFacts}>
                {stage.facts.map((fact) => (
                  <div key={`${stage.id}:${fact.label}`}>
                    <dt>{fact.label}</dt>
                    <dd title={fact.value}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function TechnicalPipelineHeading() {
  return (
    <div className={styles.technicalHeading}>
      <span>
        <small>Factory Pipeline · observed stages</small>
        <h2 id="technical-pipeline-heading">Code to verified workspace</h2>
      </span>
      <span className={styles.technicalLegend}>Metadata only · no generated source or output</span>
    </div>
  );
}

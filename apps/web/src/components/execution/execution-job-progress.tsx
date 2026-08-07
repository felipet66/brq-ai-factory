import type { ExecutionJobView } from '@/api/execution-contracts';

type ProgressStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'SKIPPED';

interface ExecutionJobProgressProps {
  readonly job: ExecutionJobView | null;
}

interface ProgressStage {
  readonly label: 'Fila' | 'Executando' | 'Finalizado';
  readonly status: ProgressStatus;
  readonly statusLabel: string;
}

function progressStages(job: ExecutionJobView | null): readonly ProgressStage[] {
  if (job === null || job.status === 'QUEUED') {
    return [
      { label: 'Fila', status: 'RUNNING', statusLabel: 'Na fila' },
      { label: 'Executando', status: 'PENDING', statusLabel: 'Pendente' },
      { label: 'Finalizado', status: 'PENDING', statusLabel: 'Pendente' },
    ];
  }
  if (job.status === 'RUNNING') {
    return [
      { label: 'Fila', status: 'SUCCESS', statusLabel: 'Concluído' },
      { label: 'Executando', status: 'RUNNING', statusLabel: 'Em andamento' },
      { label: 'Finalizado', status: 'PENDING', statusLabel: 'Pendente' },
    ];
  }
  if (job.status === 'SUCCESS') {
    return [
      { label: 'Fila', status: 'SUCCESS', statusLabel: 'Concluído' },
      { label: 'Executando', status: 'SUCCESS', statusLabel: 'Concluído' },
      { label: 'Finalizado', status: 'SUCCESS', statusLabel: 'Concluído' },
    ];
  }

  const terminalLabel = job.status === 'FAILED' ? 'Falhou' : 'Cancelado';
  return [
    { label: 'Fila', status: 'SUCCESS', statusLabel: 'Concluído' },
    {
      label: 'Executando',
      status: job.startedAt === null ? 'SKIPPED' : job.status,
      statusLabel: job.startedAt === null ? 'Ignorado' : terminalLabel,
    },
    { label: 'Finalizado', status: job.status, statusLabel: terminalLabel },
  ];
}

export function ExecutionJobProgress({ job }: ExecutionJobProgressProps) {
  return (
    <section className="execution-timeline" aria-labelledby="job-progress-heading">
      <div className="execution-timeline__heading">
        <h3 id="job-progress-heading">Progresso da execução</h3>
        <span>{job?.status ?? 'QUEUED'}</span>
      </div>
      <ol className="execution-timeline__stages">
        {progressStages(job).map((stage) => (
          <li key={stage.label} data-status={stage.status}>
            <span className="timeline-status-dot" aria-hidden="true" />
            <div>
              <strong>{stage.label}</strong>
              <span>{stage.statusLabel}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

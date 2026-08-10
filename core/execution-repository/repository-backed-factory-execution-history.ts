import type { LogLevel } from '@brq/shared/logger/logger';
import type { FactoryExecutionHistoryRecorder } from '@brq/observability';

import type {
  CreateRepositoryBackedExecutionHistoryOptions,
  FactoryExecutionRecordRepository,
  PersistentFactoryExecutionHistory,
} from './contracts';
import { logRepositoryOperation } from './logging';

interface CreateRepositoryBackedFactoryExecutionHistoryOptions extends Omit<
  CreateRepositoryBackedExecutionHistoryOptions,
  'history' | 'repository'
> {
  readonly history: FactoryExecutionHistoryRecorder;
  readonly repository: FactoryExecutionRecordRepository;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createRepositoryBackedFactoryExecutionHistory(
  options: CreateRepositoryBackedFactoryExecutionHistoryOptions,
): PersistentFactoryExecutionHistory {
  if (
    typeof options.history?.beginFactory !== 'function' ||
    typeof options.history?.capture !== 'function' ||
    typeof options.history?.completeFactory !== 'function' ||
    typeof options.history?.get !== 'function' ||
    typeof options.repository?.saveObservation !== 'function'
  ) {
    throw new TypeError('Configuração do histórico persistido da Factory inválida.');
  }

  const queues = new Map<string, Promise<void>>();
  const enqueue = (workflowId: string, operation: () => Promise<void>): void => {
    const previous = queues.get(workflowId) ?? Promise.resolve();
    const next = previous.then(operation).catch((error: unknown) => {
      logRepositoryOperation(
        options.logger,
        'warn',
        'execution.repository.factory_observation.failed',
        {
          workflowId,
          errorCode:
            error !== null && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'EXECUTION_REPOSITORY_PERSISTENCE_FAILED',
        },
      );
    });
    queues.set(workflowId, next);
  };

  const persistSnapshot = (id: string | null): void => {
    if (id === null) return;
    const snapshot = options.history.get(id);
    if (snapshot === null) return;
    enqueue(snapshot.workflowId, async () => {
      await options.repository.saveObservation(snapshot.workflowId, snapshot);
    });
  };

  const history: PersistentFactoryExecutionHistory = {
    beginFactory(request): void {
      options.history.beginFactory(request);
    },

    capture(level: LogLevel, event: string, context: Readonly<Record<string, unknown>>): void {
      options.history.capture(level, event, context);
      persistSnapshot(
        identifier(context.executionId) ??
          identifier(context.workflowId) ??
          identifier(context.requestId),
      );
    },

    completeFactory(result): void {
      options.history.completeFactory(result);
      persistSnapshot(result.executionId);
    },

    get(id: string) {
      return options.history.get(id);
    },

    async flush(workflowId: string): Promise<void> {
      const pending = queues.get(workflowId);
      await (pending ?? Promise.resolve());
      if (pending !== undefined && queues.get(workflowId) === pending) queues.delete(workflowId);
    },
  };

  return Object.freeze(history);
}

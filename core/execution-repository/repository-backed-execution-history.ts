import type { LogLevel } from '@brq/shared/logger/logger';

import type {
  CreateRepositoryBackedExecutionHistoryOptions,
  PersistentExecutionHistory,
} from './contracts';
import { logRepositoryOperation } from './logging';

function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function createRepositoryBackedExecutionHistory(
  options: CreateRepositoryBackedExecutionHistoryOptions,
): PersistentExecutionHistory {
  if (
    typeof options.history?.begin !== 'function' ||
    typeof options.history?.capture !== 'function' ||
    typeof options.history?.complete !== 'function' ||
    typeof options.history?.get !== 'function' ||
    typeof options.repository?.saveObservation !== 'function'
  ) {
    throw new TypeError('Configuração do histórico persistido inválida.');
  }

  const queues = new Map<string, Promise<void>>();

  const enqueue = (workflowId: string, operation: () => Promise<void>): void => {
    const previous = queues.get(workflowId) ?? Promise.resolve();
    const next = previous.then(operation).catch((error: unknown) => {
      logRepositoryOperation(options.logger, 'warn', 'execution.repository.observation.failed', {
        workflowId,
        errorCode:
          error !== null && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'EXECUTION_REPOSITORY_PERSISTENCE_FAILED',
      });
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

  const history: PersistentExecutionHistory = {
    begin(request): void {
      options.history.begin(request);
    },

    capture(level: LogLevel, event: string, context: Readonly<Record<string, unknown>>): void {
      options.history.capture(level, event, context);
      persistSnapshot(
        identifier(context.executionId) ??
          identifier(context.workflowId) ??
          identifier(context.requestId),
      );
    },

    complete(result): void {
      options.history.complete(result);
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

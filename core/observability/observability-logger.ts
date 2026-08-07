import type { Logger, LogLevel } from '@brq/shared/logger/logger';

import type { CreateObservabilityLoggerOptions } from './contracts';

export function createObservabilityLogger(options: CreateObservabilityLoggerOptions): Logger {
  const emit = (
    level: LogLevel,
    event: string,
    context: Readonly<Record<string, unknown>> = {},
  ): void => {
    options.delegate[level](event, context);
    try {
      options.history.capture(level, event, context);
    } catch {
      // Observability is deliberately fail-open and cannot alter the execution outcome.
    }
  };
  const logger: Logger = {
    debug: (event, context) => emit('debug', event, context),
    info: (event, context) => emit('info', event, context),
    warn: (event, context) => emit('warn', event, context),
    error: (event, context) => emit('error', event, context),
  };
  return Object.freeze(logger);
}

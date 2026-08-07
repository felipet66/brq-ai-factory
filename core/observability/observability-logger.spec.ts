import type { Logger } from '@brq/shared/logger/logger';
import { describe, expect, it, vi } from 'vitest';

import type { ExecutionHistoryRecorder } from './contracts';
import { createObservabilityLogger } from './observability-logger';

function history(capture: ExecutionHistoryRecorder['capture']): ExecutionHistoryRecorder {
  return { begin() {}, capture, complete() {}, get: () => null };
}

describe('Observability logger bridge', () => {
  it('delega o log original e entrega o mesmo evento ao recorder', () => {
    const delegate: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const capture = vi.fn();
    const logger = createObservabilityLogger({ delegate, history: history(capture) });
    const context = { executionId: `execution-${'a'.repeat(32)}` };
    logger.debug('execution.created', context);
    logger.info('execution.started', context);
    logger.warn('execution.cancelled', context);
    logger.error('execution.failed', context);
    expect(delegate.debug).toHaveBeenCalledOnce();
    expect(delegate.info).toHaveBeenCalledOnce();
    expect(delegate.warn).toHaveBeenCalledOnce();
    expect(delegate.error).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenNthCalledWith(1, 'debug', 'execution.created', context);
    expect(capture).toHaveBeenNthCalledWith(2, 'info', 'execution.started', context);
    expect(capture).toHaveBeenNthCalledWith(3, 'warn', 'execution.cancelled', context);
    expect(capture).toHaveBeenNthCalledWith(4, 'error', 'execution.failed', context);
  });

  it('é fail-open quando o recorder falha', () => {
    const delegate: Logger = { debug() {}, info: vi.fn(), warn() {}, error() {} };
    const logger = createObservabilityLogger({
      delegate,
      history: history(() => {
        throw new Error('store unavailable');
      }),
    });
    expect(() => logger.info('execution.started', {})).not.toThrow();
    expect(delegate.info).toHaveBeenCalledTimes(1);
  });
});

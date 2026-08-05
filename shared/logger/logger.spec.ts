import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

describe('createLogger', () => {
  it('should emit structured JSON and redact sensitive fields', () => {
    const lines: string[] = [];
    const logger = createLogger({
      sink: (line) => lines.push(line),
      now: () => new Date('2026-08-04T20:00:00.000Z'),
    });

    logger.info('foundation.ready', {
      executionId: 'execution_123',
      apiKey: 'not-safe',
    });

    expect(JSON.parse(lines[0] ?? '')).toEqual({
      level: 'info',
      event: 'foundation.ready',
      executionId: 'execution_123',
      apiKey: '[REDACTED]',
      timestamp: '2026-08-04T20:00:00.000Z',
    });
  });
});

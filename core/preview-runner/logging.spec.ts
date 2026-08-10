import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { logPreviewEvent, previewSessionLogContext } from './logging';
import { createRunningPreviewSessionFixture } from './testing/preview-runner-fixtures';

describe('Preview Runner logging', () => {
  it('logs only safe metadata and hashes', () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    logPreviewEvent(
      logger,
      'info',
      'preview.running',
      previewSessionLogContext(createRunningPreviewSessionFixture()),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('previewSessionHash');
    expect(lines[0]).not.toMatch(/content|index\.html|hostPort|containerId|cookie|token/iu);
  });

  it('keeps logging best effort', () => {
    const logger = createLogger({
      sink: () => {
        throw new Error('sink');
      },
    });
    expect(() => logPreviewEvent(logger, 'info', 'preview.running', {})).not.toThrow();
  });
});

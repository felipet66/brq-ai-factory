import { createLogger } from '@brq/shared/logger/logger';
import { describe, expect, it } from 'vitest';

import { createArtifactGenerator } from './artifact-generator';
import {
  createArtifactGenerationRequest,
  createArtifactSpecification,
  createSummaryTemplate,
  createValidatedJsonResult,
} from './testing/artifact-generator-fixtures';

describe('Artifact Generator logging', () => {
  it('logs only technical metadata on success', () => {
    const secret = 'SENSITIVE-ARTIFACT-CONTENT-9173';
    const lines: string[] = [];
    const validation = createValidatedJsonResult({
      value: secret,
    });
    const specification = createArtifactSpecification({
      sourceContract: validation.metadata.contract,
      templates: [
        createSummaryTemplate({
          name: secret,
          bindings: [{ id: 'value', path: ['value'] }],
          fragments: [
            { kind: 'LITERAL', value: `${secret}:` },
            { kind: 'BINDING', bindingId: 'value', serialization: 'TEXT' },
          ],
        }),
      ],
    });
    const logger = createLogger({
      sink: (line) => lines.push(line),
      now: () => new Date('2026-08-05T12:00:00.000Z'),
    });

    createArtifactGenerator({ logger, now: () => 10 }).generate({ validation, specification });

    expect(lines).toHaveLength(2);
    expect(lines.join('\n')).toContain('artifact.generation.started');
    expect(lines.join('\n')).toContain('artifact.generation.completed');
    expect(lines.join('\n')).toContain('contentHash');
    expect(lines.join('\n')).not.toContain(secret);
    expect(lines.join('\n')).not.toContain('validatedOutput');
    expect(lines.join('\n')).not.toContain('fragments');
    expect(lines.join('\n')).not.toContain('bindings');
  });

  it('does not log binding paths or partial content when a late artifact fails', () => {
    const secretPath = 'sensitiveFieldName';
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });
    const request = createArtifactGenerationRequest({
      specification: createArtifactSpecification({
        templates: [
          createSummaryTemplate(),
          createSummaryTemplate({
            id: 'late-template',
            filename: 'late.md',
            bindings: [{ id: 'missing', path: [secretPath] }],
            fragments: [{ kind: 'BINDING', bindingId: 'missing', serialization: 'TEXT' }],
          }),
        ],
      }),
    });

    expect(() => createArtifactGenerator({ logger }).generate(request)).toThrow();

    expect(lines.join('\n')).toContain('artifact.generation.failed');
    expect(lines.join('\n')).not.toContain('artifact.generation.completed');
    expect(lines.join('\n')).not.toContain(secretPath);
    expect(lines.join('\n')).not.toContain('# Resumo genérico');
  });
});

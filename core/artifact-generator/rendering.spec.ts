import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { calculateContentHash } from './content-hashing';
import { ARTIFACT_GENERATOR_ERROR_CODES } from './errors';
import { renderResolvedArtifact } from './rendering';
import type { ResolvedArtifactModel } from './resolved-artifact-model';
import { HASH_A } from './testing/artifact-generator-fixtures';

function textModel(fragments: readonly string[]): ResolvedArtifactModel {
  return {
    templateId: 'text-template',
    name: 'Text artifact',
    filename: 'artifact.md',
    type: 'TEXT_ARTIFACT',
    mediaType: 'text/markdown',
    templateHash: HASH_A,
    format: 'TEXT',
    fragments,
  };
}

describe('Artifact rendering', () => {
  it('renders only a resolved text model and reports exact bytes and hashes', () => {
    const content = '# Olá 🌎\n';
    const result = renderResolvedArtifact(textModel(['# ', 'Olá', ' ', '🌎', '\n']), 1_000, 4);

    expect(result.draft.content).toBe(content);
    expect(result.metadata.byteLength).toBe(Buffer.byteLength(content, 'utf8'));
    expect(result.metadata.contentHash).toBe(calculateContentHash(content));
    expect(result.metadata.mediaType).toBe('text/markdown');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.draft)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
  });

  it('renders canonical pretty JSON with a final LF and valid syntax', () => {
    const model: ResolvedArtifactModel = {
      templateId: 'json-template',
      name: 'JSON artifact',
      filename: 'artifact.json',
      type: 'JSON_ARTIFACT',
      mediaType: 'application/json',
      templateHash: HASH_A,
      format: 'JSON',
      value: { z: 1, nested: { z: false, a: true }, a: 2 },
    };
    const result = renderResolvedArtifact(model, 10_000, 0);

    expect(result.draft.content).toBe(
      '{\n  "a": 2,\n  "nested": {\n    "a": true,\n    "z": false\n  },\n  "z": 1\n}\n',
    );
    expect(JSON.parse(result.draft.content)).toEqual(model.value);
  });

  it('accepts the exact UTF-8 byte budget and rejects one byte less', () => {
    const model = textModel(['á🌎']);
    const exactBytes = Buffer.byteLength('á🌎', 'utf8');

    expect(renderResolvedArtifact(model, exactBytes, 0).metadata.byteLength).toBe(exactBytes);
    expect(() => renderResolvedArtifact(model, exactBytes - 1, 9)).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED,
        stage: 'BUDGET_VALIDATION',
        durationMs: 9,
      }),
    );
  });

  it('rejects empty or whitespace-only rendered content', () => {
    expect(() => renderResolvedArtifact(textModel([' ', '\n']), 100, 0)).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.EMPTY_CONTENT,
        stage: 'RENDERING',
      }),
    );
  });
});

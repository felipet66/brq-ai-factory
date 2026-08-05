import { describe, expect, it } from 'vitest';

import type { ArtifactTemplate } from './contracts';
import { resolveArtifactModel } from './binding-resolution';
import { ARTIFACT_GENERATOR_ERROR_CODES } from './errors';
import { renderResolvedArtifact } from './rendering';
import {
  createDataTemplate,
  createSummaryTemplate,
  HASH_A,
} from './testing/artifact-generator-fixtures';

describe('Artifact binding resolution', () => {
  it('resolves named bindings and array indices without exposing paths to the renderer', () => {
    const template = createSummaryTemplate({
      bindings: [{ id: 'detail-id', path: ['details', 0, 'id'] }],
      fragments: [
        { kind: 'LITERAL', value: 'Item: ' },
        { kind: 'BINDING', bindingId: 'detail-id', serialization: 'TEXT' },
      ],
    });

    const model = resolveArtifactModel(
      template,
      {
        format: 'JSON_SCHEMA',
        data: { details: [{ id: 'ITEM-001' }] },
      },
      HASH_A,
      10_000,
      7,
    );

    expect(model).toMatchObject({
      templateId: template.id,
      format: 'TEXT',
      fragments: ['Item: ', 'ITEM-001'],
    });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.format === 'TEXT' ? model.fragments : [])).toBe(true);
  });

  it('supports exact TEXT, compact JSON and pretty JSON serialization', () => {
    const template = createSummaryTemplate({
      bindings: [
        { id: 'title', path: ['title'] },
        { id: 'details', path: ['details'] },
      ],
      fragments: [
        { kind: 'BINDING', bindingId: 'title', serialization: 'TEXT' },
        { kind: 'LITERAL', value: '\ncompact=' },
        { kind: 'BINDING', bindingId: 'details', serialization: 'JSON_COMPACT' },
        { kind: 'LITERAL', value: '\npretty=' },
        { kind: 'BINDING', bindingId: 'details', serialization: 'JSON_PRETTY' },
      ],
    });
    const model = resolveArtifactModel(
      template,
      { format: 'JSON_SCHEMA', data: { title: 'Título', details: { z: 1, a: true } } },
      HASH_A,
      10_000,
      0,
    );

    expect(model.format).toBe('TEXT');
    if (model.format !== 'TEXT') throw new Error('Expected text model.');
    expect(model.fragments.join('')).toBe(
      'Título\ncompact={"a":true,"z":1}\npretty={\n  "a": true,\n  "z": 1\n}',
    );
  });

  it('never recursively interprets template-looking bound or literal content', () => {
    const template = createSummaryTemplate({
      bindings: [{ id: 'value', path: ['value'] }],
      fragments: [
        { kind: 'LITERAL', value: '{{value}} ${value} ' },
        { kind: 'BINDING', bindingId: 'value', serialization: 'TEXT' },
      ],
    });
    const marker = '{{second.path}} ${process.env.SECRET}';
    const model = resolveArtifactModel(
      template,
      { format: 'JSON_SCHEMA', data: { value: marker, second: { path: 'must-not-expand' } } },
      HASH_A,
      10_000,
      0,
    );
    const artifact = renderResolvedArtifact(model, 10_000, 0);

    expect(artifact.draft.content).toBe(`{{value}} \${value} ${marker}`);
    expect(artifact.draft.content).not.toContain('must-not-expand');
  });

  it('does not resolve inherited properties or prototype-chain segments', () => {
    const inherited = Object.create({ secret: 'inherited-secret' }) as Record<string, unknown>;
    inherited.safe = 'own-value';
    const template = createSummaryTemplate({
      bindings: [{ id: 'secret', path: ['secret'] }],
      fragments: [{ kind: 'BINDING', bindingId: 'secret', serialization: 'TEXT' }],
    });

    expect(() =>
      resolveArtifactModel(
        template,
        { format: 'JSON_SCHEMA', data: inherited as never },
        HASH_A,
        10_000,
        3,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND,
        stage: 'BINDING_RESOLUTION',
      }),
    );

    for (const segment of ['__proto__', 'prototype', 'constructor']) {
      const unsafe = {
        ...template,
        bindings: [{ id: 'secret', path: [segment] }],
      } as ArtifactTemplate;
      expect(() =>
        resolveArtifactModel(unsafe, { format: 'JSON_SCHEMA', data: {} }, HASH_A, 10_000, 0),
      ).toThrowError(
        expect.objectContaining({ code: ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND }),
      );
    }
  });

  it('classifies missing values and TEXT type mismatches without coercion', () => {
    const missing = createSummaryTemplate({
      bindings: [{ id: 'missing', path: ['missing'] }],
      fragments: [{ kind: 'BINDING', bindingId: 'missing', serialization: 'TEXT' }],
    });
    const wrongType = createSummaryTemplate({
      bindings: [{ id: 'value', path: ['value'] }],
      fragments: [{ kind: 'BINDING', bindingId: 'value', serialization: 'TEXT' }],
    });

    expect(() =>
      resolveArtifactModel(missing, { format: 'JSON_SCHEMA', data: {} }, HASH_A, 10_000, 0),
    ).toThrowError(
      expect.objectContaining({ code: ARTIFACT_GENERATOR_ERROR_CODES.BINDING_NOT_FOUND }),
    );
    expect(() =>
      resolveArtifactModel(
        wrongType,
        { format: 'JSON_SCHEMA', data: { value: 42 } },
        HASH_A,
        10_000,
        0,
      ),
    ).toThrowError(
      expect.objectContaining({ code: ARTIFACT_GENERATOR_ERROR_CODES.BINDING_TYPE_MISMATCH }),
    );
  });

  it('clones and freezes a JSON root binding independently from its source', () => {
    const source = { z: 1, nested: { value: 'original' }, a: true };
    const model = resolveArtifactModel(
      createDataTemplate({
        bindings: [{ id: 'root', path: [] }],
        rootBindingId: 'root',
      }),
      { format: 'JSON_SCHEMA', data: source },
      HASH_A,
      10_000,
      0,
    );

    expect(model.format).toBe('JSON');
    if (model.format !== 'JSON') throw new Error('Expected JSON model.');
    expect(model.value).toEqual(source);
    expect(model.value).not.toBe(source);
    expect(Object.isFrozen(model.value)).toBe(true);
    expect(Object.isFrozen((model.value as { nested: object }).nested)).toBe(true);
  });

  it('rejects repeated resolved content incrementally before rendering', () => {
    const template = createSummaryTemplate({
      bindings: [{ id: 'value', path: ['value'] }],
      fragments: [
        { kind: 'BINDING', bindingId: 'value', serialization: 'TEXT' },
        { kind: 'BINDING', bindingId: 'value', serialization: 'TEXT' },
      ],
    });

    expect(() =>
      resolveArtifactModel(
        template,
        { format: 'JSON_SCHEMA', data: { value: 'á'.repeat(300) } },
        HASH_A,
        1_000,
        11,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: ARTIFACT_GENERATOR_ERROR_CODES.CONTENT_LIMIT_EXCEEDED,
        stage: 'BUDGET_VALIDATION',
        durationMs: 11,
      }),
    );
  });
});

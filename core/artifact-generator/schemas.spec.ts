import { describe, expect, it } from 'vitest';

import { createArtifactGenerator } from './artifact-generator';
import {
  artifactGenerationRequestSchema,
  artifactGenerationResultSchema,
  artifactSpecificationSchema,
  artifactTemplateSchema,
  bindingPathSegmentSchema,
} from './schemas';
import {
  createDataTemplate,
  createArtifactGenerationRequest,
  createArtifactSpecification,
  createSummaryTemplate,
} from './testing/artifact-generator-fixtures';

describe('Artifact Generator schemas', () => {
  it('accepts the canonical request and rejects unknown fields', () => {
    const request = createArtifactGenerationRequest();

    expect(artifactGenerationRequestSchema.safeParse(request).success).toBe(true);
    expect(
      artifactGenerationRequestSchema.safeParse({ ...request, unexpected: true }).success,
    ).toBe(false);
  });

  it.each(['', '__proto__', 'prototype', 'constructor'])(
    'rejects unsafe path segment %j',
    (segment) => {
      expect(bindingPathSegmentSchema.safeParse(segment).success).toBe(false);
    },
  );

  it('requires unique, referenced bindings inside each template', () => {
    const base = createSummaryTemplate();

    expect(
      artifactTemplateSchema.safeParse({
        ...base,
        bindings: [...base.bindings, base.bindings[0]],
      }).success,
    ).toBe(false);
    expect(
      artifactTemplateSchema.safeParse({
        ...base,
        fragments: [
          ...base.fragments,
          { kind: 'BINDING', bindingId: 'missing', serialization: 'TEXT' },
        ],
      }).success,
    ).toBe(false);
    expect(
      artifactTemplateSchema.safeParse({
        ...base,
        fragments: base.fragments.filter(
          (fragment) => fragment.kind !== 'BINDING' || fragment.bindingId !== 'summary-body',
        ),
      }).success,
    ).toBe(false);
  });

  it('reports a missing binding at its original fragment index', () => {
    const result = artifactTemplateSchema.safeParse({
      ...createSummaryTemplate(),
      bindings: [{ id: 'known', path: ['summary', 'body'] }],
      fragments: [
        { kind: 'LITERAL', value: 'prefix' },
        { kind: 'BINDING', bindingId: 'missing', serialization: 'TEXT' },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected schema failure.');
    expect(result.error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['fragments', 1, 'bindingId'] })]),
    );
  });

  it.each([
    '',
    '../artifact.md',
    '/tmp/artifact.md',
    'nested/artifact.md',
    'nested\\artifact.md',
    'C:\\artifact.md',
    'CON.md',
    'artifact.md ',
  ])('rejects unsafe or normalized filename %j', (filename) => {
    expect(artifactTemplateSchema.safeParse(createSummaryTemplate({ filename })).success).toBe(
      false,
    );
  });

  it('rejects portable filename collisions and duplicate template IDs', () => {
    const summary = createSummaryTemplate();

    expect(
      artifactSpecificationSchema.safeParse(
        createArtifactSpecification({
          templates: [
            summary,
            createSummaryTemplate({ id: 'other-template', filename: 'SUMMARY.MD' }),
          ],
        }),
      ).success,
    ).toBe(false);
    expect(
      artifactSpecificationSchema.safeParse(
        createArtifactSpecification({
          templates: [summary, createDataTemplate({ id: summary.id })],
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects filenames that collide after Unicode normalization', () => {
    expect(
      artifactSpecificationSchema.safeParse(
        createArtifactSpecification({
          templates: [
            createSummaryTemplate({ filename: 'résumé.md' }),
            createSummaryTemplate({ id: 'other-template', filename: 're\u0301sume\u0301.md' }),
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it('keeps logical type and media type separate and enforces format-compatible media types', () => {
    const parsed = artifactTemplateSchema.parse(createSummaryTemplate());

    expect(parsed.type).toBe('SUMMARY');
    expect(parsed.mediaType).toBe('text/markdown');
    expect(
      artifactTemplateSchema.safeParse({
        ...createSummaryTemplate(),
        mediaType: 'application/json',
      }).success,
    ).toBe(false);
    expect(
      artifactTemplateSchema.safeParse({
        ...createDataTemplate(),
        mediaType: 'text/plain',
      }).success,
    ).toBe(false);
  });

  it.each([' specification ', ' template '])('does not silently normalize identifier %j', (id) => {
    const candidate = id.includes('specification')
      ? createArtifactSpecification({ id })
      : createSummaryTemplate({ id });
    const schema = id.includes('specification')
      ? artifactSpecificationSchema
      : artifactTemplateSchema;

    expect(schema.safeParse(candidate).success).toBe(false);
  });

  it('validates result counts and UTF-8 byte totals coherently', () => {
    const result = createArtifactGenerator().generate(createArtifactGenerationRequest());

    expect(artifactGenerationResultSchema.safeParse(result).success).toBe(true);
    expect(
      artifactGenerationResultSchema.safeParse({
        ...result,
        metadata: { ...result.metadata, artifactCount: result.metadata.artifactCount + 1 },
      }).success,
    ).toBe(false);
    expect(
      artifactGenerationResultSchema.safeParse({
        ...result,
        metadata: { ...result.metadata, totalBytes: result.metadata.totalBytes + 1 },
      }).success,
    ).toBe(false);
  });
});

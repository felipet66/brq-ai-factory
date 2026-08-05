import { describe, expect, it } from 'vitest';

import { calculateContentHash, calculateValidatedValueHash } from './content-hashing';
import {
  calculateDraftHash,
  calculateGenerationHash,
  calculateSpecificationHash,
  calculateStructuralHash,
  calculateTemplateHash,
} from './structural-hashing';
import {
  createArtifactSpecification,
  createSummaryTemplate,
  createValidatedJsonResult,
  HASH_A,
  HASH_B,
} from './testing/artifact-generator-fixtures';

describe('Artifact Generator hashes', () => {
  it('separates an exact content hash from canonical structural hashes', () => {
    expect(calculateContentHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(calculateContentHash('abc\n')).not.toBe(calculateContentHash('abc'));
    expect(calculateStructuralHash({ b: 2, a: 1 })).toBe(calculateStructuralHash({ a: 1, b: 2 }));
  });

  it('hashes the validated value using its accepted representation', () => {
    const validation = createValidatedJsonResult({ b: 2, a: 1 });

    expect(validation.validatedOutput).not.toBeNull();
    expect(calculateValidatedValueHash(validation.validatedOutput!)).toBe(
      calculateContentHash('{"a":1,"b":2}'),
    );
  });

  it('changes template and specification hashes when declarative structure changes', () => {
    const template = createSummaryTemplate();
    const changedTemplate = createSummaryTemplate({ mediaType: 'text/plain' });
    const specification = createArtifactSpecification({ templates: [template] });
    const changedSpecification = createArtifactSpecification({ templates: [changedTemplate] });

    expect(calculateTemplateHash(template)).not.toBe(calculateTemplateHash(changedTemplate));
    expect(calculateSpecificationHash(specification)).not.toBe(
      calculateSpecificationHash(changedSpecification),
    );
  });

  it('hashes a draft structurally and includes exact content identity', () => {
    const draft = {
      name: 'Summary',
      filename: 'summary.md',
      type: 'SUMMARY',
      content: '# Summary',
    };

    expect(calculateDraftHash(draft)).toBe(calculateDraftHash({ ...draft }));
    expect(calculateDraftHash(draft)).not.toBe(
      calculateDraftHash({ ...draft, content: '# Summary\n' }),
    );
    expect(calculateDraftHash(draft)).not.toBe(calculateContentHash(draft.content));
  });

  it('makes generation hashes source- and order-sensitive without raw content input', () => {
    const first = {
      draft: { name: 'A', filename: 'a.md', type: 'A', content: 'A' },
      metadata: {
        templateId: 'a',
        format: 'TEXT' as const,
        mediaType: 'text/plain' as const,
        templateHash: HASH_A,
        contentHash: HASH_A,
        draftHash: HASH_B,
        byteLength: 1,
      },
    };
    const second = {
      ...first,
      draft: { name: 'B', filename: 'b.md', type: 'B', content: 'B' },
      metadata: { ...first.metadata, templateId: 'b', contentHash: HASH_B },
    };
    const base = {
      specificationHash: HASH_A,
      sourceValidationHash: HASH_B,
      sourceValidatedValueHash: HASH_A,
      artifacts: [first, second],
    };

    expect(calculateGenerationHash(base)).not.toBe(
      calculateGenerationHash({ ...base, artifacts: [second, first] }),
    );
    expect(calculateGenerationHash(base)).not.toBe(
      calculateGenerationHash({ ...base, sourceValidatedValueHash: HASH_B }),
    );
  });
});

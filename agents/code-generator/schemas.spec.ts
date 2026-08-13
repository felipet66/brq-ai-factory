import { describe, expect, it } from 'vitest';

import { CODE_GENERATOR_CONTRACT_LIMITS } from './limits';
import {
  codeGenerationApprovalSchema,
  codeGenerationRequestSchema,
  generatedCodeProposalSchema,
  rawGeneratedCodeFileSchema,
} from './schemas';
import {
  createCodeGenerationRequest,
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from './testing/code-generator-fixtures';

describe('Code Generator public schemas', () => {
  it('accepts the canonical request, approval envelope and proposal', () => {
    const request = createCodeGenerationRequest();
    expect(codeGenerationRequestSchema.safeParse(request).success).toBe(true);
    expect(codeGenerationApprovalSchema.safeParse(request.approval).success).toBe(true);
    expect(generatedCodeProposalSchema.safeParse(createGeneratedCodeProposal()).success).toBe(true);
  });

  it('keeps the approved limits explicit and fixed', () => {
    expect(CODE_GENERATOR_CONTRACT_LIMITS).toMatchObject({
      request: {
        technicalSpecificationBytes: 224 * 1024,
        knowledgeBytes: 48 * 1024,
        knowledgeDocuments: 4,
        promptBytes: 384 * 1024,
        maxOutputTokens: 131_072,
        generationConstraints: 8,
      },
      generation: {
        files: 96,
        fileBytes: 64 * 1024,
        bundleBytes: 384 * 1024,
        entrypoints: 16,
        pathBytes: 512,
        pathSegments: 20,
        segmentBytes: 255,
      },
    });
    expect(Object.isFrozen(CODE_GENERATOR_CONTRACT_LIMITS)).toBe(true);
    expect(Object.isFrozen(CODE_GENERATOR_CONTRACT_LIMITS.generation)).toBe(true);
  });

  it('rejects a structurally valid TechnicalSpecification above the aggregate byte ceiling', () => {
    const base = createCodeGeneratorTechnicalSpecification();
    const itemText = 'x'.repeat(1_000);
    const description = 'y'.repeat(2_000);
    const technicalSpecification = createCodeGeneratorTechnicalSpecification({
      architecture: {
        ...base.architecture,
        principles: Array.from({ length: 20 }, () => itemText),
        constraints: Array.from({ length: 30 }, () => itemText),
        qualityAttributes: Array.from({ length: 20 }, () => itemText),
        trustBoundaries: Array.from({ length: 30 }, () => itemText),
      },
      modules: Array.from({ length: 80 }, (_, index) => ({
        ...base.modules[0]!,
        id: `MOD-${String(index + 1).padStart(3, '0')}`,
        name: `Generated module ${index + 1}`,
        path: `core/generated-module-${index + 1}`,
        responsibility: description,
      })),
    });
    const result = codeGenerationRequestSchema.safeParse(
      createCodeGenerationRequest({ technicalSpecification }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['technicalSpecification'],
            message: expect.stringContaining('excede'),
          }),
        ]),
      );
    }
  });

  it('rejects unknown request fields and malformed approval evidence', () => {
    const request = createCodeGenerationRequest();
    expect(
      codeGenerationRequestSchema.safeParse({ ...request, rawPrompt: 'forbidden' }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        deliveryIntent: { version: '1.0.0', mode: 'GREENFIELD' },
      }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        approval: { ...request.approval, qaReadiness: 'PARTIALLY_READY' },
      }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        approval: { ...request.approval, technicalHandoffVerified: false },
      }).success,
    ).toBe(false);
  });

  it('allows callers only to reduce operational limits within public ceilings', () => {
    const request = createCodeGenerationRequest();
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        limits: {
          knowledgeMaxDocuments: 4,
          knowledgeMaxBytes: 48 * 1024,
          promptMaxBytes: 384 * 1024,
          maxOutputTokens: 131_072,
          timeoutMs: 600_000,
        },
      }).success,
    ).toBe(true);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        limits: { knowledgeMaxDocuments: 5 },
      }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        limits: { promptMaxBytes: 384 * 1024 + 1 },
      }).success,
    ).toBe(false);
  });

  it('accepts bounded dynamic generation constraints and rejects empty, duplicate or excessive inputs', () => {
    const request = createCodeGenerationRequest();
    const constraint = {
      id: 'constraint:factory-profile',
      serialization: 'JSON' as const,
      value: {
        profileId: 'NODE_WEB_PREVIEW_24_V1',
        requiredFiles: ['index.html'],
      },
    };

    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        generationConstraints: [constraint],
      }).success,
    ).toBe(true);
    expect(
      codeGenerationRequestSchema.safeParse({ ...request, generationConstraints: [] }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        generationConstraints: [constraint, constraint],
      }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        generationConstraints: Array.from(
          { length: CODE_GENERATOR_CONTRACT_LIMITS.request.generationConstraints + 1 },
          (_, index) => ({ ...constraint, id: `constraint:factory-profile-${index}` }),
        ),
      }).success,
    ).toBe(false);
    expect(
      codeGenerationRequestSchema.safeParse({
        ...request,
        constraints: [constraint],
      }).success,
    ).toBe(false);
  });

  it('keeps raw files textual and rejects model-authored metadata or binary encodings', () => {
    const file = createGeneratedCodeProposal().files[0]!;
    expect(rawGeneratedCodeFileSchema.safeParse(file).success).toBe(true);
    expect(rawGeneratedCodeFileSchema.safeParse({ ...file, encoding: 'BASE64' }).success).toBe(
      false,
    );
    expect(
      rawGeneratedCodeFileSchema.safeParse({ ...file, mediaType: 'application/octet-stream' })
        .success,
    ).toBe(false);
    expect(
      rawGeneratedCodeFileSchema.safeParse({ ...file, contentHash: '0'.repeat(64) }).success,
    ).toBe(false);
  });

  it('requires at least one structural entrypoint and preserves empty files for business rejection', () => {
    const proposal = createGeneratedCodeProposal();
    expect(generatedCodeProposalSchema.safeParse({ ...proposal, entrypoints: [] }).success).toBe(
      false,
    );
    expect(generatedCodeProposalSchema.safeParse({ ...proposal, files: [] }).success).toBe(true);
  });
});

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

  it('rejects unknown request fields and malformed approval evidence', () => {
    const request = createCodeGenerationRequest();
    expect(
      codeGenerationRequestSchema.safeParse({ ...request, rawPrompt: 'forbidden' }).success,
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

import {
  CODE_GENERATOR_AGENT_ERROR_CODES,
  CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES,
  CODE_GENERATOR_CONTRACT_LIMITS,
  codeGenerationConstraintSchema,
  codeGenerationRequestSchema,
  createCodeGeneratorAgent,
  generatedCodeBundleSchema,
  generatedCodeProposalSchema,
  loadCodeGeneratorPromptAssets,
  projectCodeGeneratorPromptContexts,
  validateCodeGenerationBusinessRules,
  type CodeGenerationRequest,
  type CodeGenerationConstraint,
  type CodeGeneratorAgentResult,
  type GeneratedCodeBundle,
} from '@brq/code-generator-agent';
import { describe, expect, it } from 'vitest';

import {
  createCodeGenerationRequest,
  createCodeGeneratorTechnicalSpecification,
  createGeneratedCodeProposal,
} from './testing/code-generator-fixtures';

describe('@brq/code-generator-agent package exports', () => {
  it('exports the facade, contracts, schemas, assets and pure Business Validation', () => {
    const request: CodeGenerationRequest = createCodeGenerationRequest();
    const constraint: CodeGenerationConstraint = {
      id: 'constraint:package-export',
      serialization: 'TEXT',
      value: 'Generate a bounded textual snapshot.',
    };
    const resultTypeCheck: CodeGeneratorAgentResult | undefined = undefined;
    const bundleTypeCheck: GeneratedCodeBundle | undefined = undefined;

    expect(createCodeGeneratorAgent).toBeTypeOf('function');
    expect(codeGenerationRequestSchema.safeParse(request).success).toBe(true);
    expect(codeGenerationConstraintSchema.safeParse(constraint).success).toBe(true);
    expect(generatedCodeProposalSchema.safeParse(createGeneratedCodeProposal()).success).toBe(true);
    expect(generatedCodeBundleSchema).toBeDefined();
    expect(resultTypeCheck).toBeUndefined();
    expect(bundleTypeCheck).toBeUndefined();
    expect(loadCodeGeneratorPromptAssets().manifest.agent).toBe('CODE_GENERATOR');
    expect(projectCodeGeneratorPromptContexts).toBeTypeOf('function');
    expect(
      validateCodeGenerationBusinessRules(
        createGeneratedCodeProposal(),
        createCodeGeneratorTechnicalSpecification(),
      ),
    ).toMatchObject({ valid: true });
    expect(CODE_GENERATOR_CONTRACT_LIMITS.generation.files).toBe(96);
    expect(CODE_GENERATOR_BUSINESS_VALIDATION_ISSUE_CODES.UNSAFE_PATH).toContain('UNSAFE_PATH');
    expect(CODE_GENERATOR_AGENT_ERROR_CODES.RUN_FAILED).toBe('CODE_GENERATOR_AGENT_RUN_FAILED');
  });

  it('keeps builders, result factories, logging and immutability internal', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/code-generator-agent');
    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).not.toHaveProperty('assembleGeneratedCodeBundle');
    expect(publicApi).not.toHaveProperty('createCodeGeneratorAgentRunRequest');
    expect(publicApi).not.toHaveProperty('createGeneratedResult');
    expect(publicApi).not.toHaveProperty('requestLogContext');
    expect(publicApi).not.toHaveProperty('sanitizeCodeGeneratorSourceCode');
  });
});

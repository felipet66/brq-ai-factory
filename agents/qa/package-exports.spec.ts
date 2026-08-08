import {
  QA_AGENT_ERROR_CODES,
  QA_BUSINESS_VALIDATION_ISSUE_CODES,
  QA_READINESS_VALUES,
  createQAAgent,
  deriveQAReadiness,
  loadQAPromptAssets,
  projectQAPromptContexts,
  qaAgentRequestSchema,
  qaAgentResultSchema,
  qaSpecificationSchema,
  validateQABusinessRules,
  type QAAgentRequest,
  type QAAgentResult,
  type QASpecification,
} from '@brq/qa-agent';
import { describe, expect, it } from 'vitest';

import { createQARequest, createQASpecification } from './testing/qa-fixtures';

describe('@brq/qa-agent package exports', () => {
  it('expõe fachada, contratos, schemas, assets e Business Validation', () => {
    const request: QAAgentRequest = createQARequest();
    const specification: QASpecification = createQASpecification();
    const resultTypeCheck: QAAgentResult | undefined = undefined;

    expect(createQAAgent).toBeTypeOf('function');
    expect(qaAgentRequestSchema.safeParse(request).success).toBe(true);
    expect(qaSpecificationSchema.safeParse(specification).success).toBe(true);
    expect(qaAgentResultSchema).toBeDefined();
    expect(resultTypeCheck).toBeUndefined();
    expect(loadQAPromptAssets().manifest.agent).toBe('QA');
    expect(projectQAPromptContexts).toBeTypeOf('function');
    expect(QA_READINESS_VALUES).toEqual(['READY', 'PARTIALLY_READY', 'REQUIRES_CLARIFICATION']);
    expect(deriveQAReadiness('READY', 'READY', [], [], [])).toBe('READY');
    expect(
      validateQABusinessRules(
        specification,
        request.productOwnerSpecification,
        request.technicalSpecification,
      ),
    ).toMatchObject({ valid: true, expectedReadiness: 'READY' });
    expect(QA_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH).toContain('READINESS_MISMATCH');
    expect(QA_AGENT_ERROR_CODES.RUN_FAILED).toBe('QA_AGENT_RUN_FAILED');
  });

  it('expõe somente a projeção pura e mantém assembly, resultado e logging internos', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/qa-agent');
    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).toHaveProperty('projectQAPromptContexts');
    expect(publicApi).not.toHaveProperty('createQAAgentRunRequest');
    expect(publicApi).not.toHaveProperty('createGeneratedResult');
    expect(publicApi).not.toHaveProperty('requestLogContext');
    expect(publicApi).not.toHaveProperty('sanitizeQASourceCode');
  });
});

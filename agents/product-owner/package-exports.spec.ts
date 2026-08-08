import {
  PRODUCT_OWNER_AGENT_ERROR_CODES,
  PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES,
  PRODUCT_OWNER_READINESS_VALUES,
  createProductOwnerAgent,
  deriveProductOwnerReadiness,
  loadProductOwnerPromptAssets,
  projectProductOwnerPromptContexts,
  productOwnerAgentRequestSchema,
  productOwnerAgentResultSchema,
  productOwnerSpecificationSchema,
  validateProductOwnerBusinessRules,
  type ProductOwnerAgentRequest,
  type ProductOwnerAgentResult,
  type ProductOwnerSpecification,
} from '@brq/product-owner-agent';
import { describe, expect, it } from 'vitest';

import {
  createProductOwnerRequest,
  createProductOwnerSpecification,
} from './testing/product-owner-fixtures';

describe('@brq/product-owner-agent package exports', () => {
  it('exposes the facade, canonical contracts, schemas, assets and Business Validation API', () => {
    const request: ProductOwnerAgentRequest = createProductOwnerRequest();
    const specification: ProductOwnerSpecification = createProductOwnerSpecification();
    const resultTypeCheck: ProductOwnerAgentResult | undefined = undefined;

    expect(createProductOwnerAgent).toBeTypeOf('function');
    expect(productOwnerAgentRequestSchema.safeParse(request).success).toBe(true);
    expect(productOwnerSpecificationSchema.safeParse(specification).success).toBe(true);
    expect(productOwnerAgentResultSchema).toBeDefined();
    expect(resultTypeCheck).toBeUndefined();
    expect(loadProductOwnerPromptAssets().manifest.agent).toBe('PRODUCT_OWNER');
    expect(projectProductOwnerPromptContexts).toBeTypeOf('function');
    expect(PRODUCT_OWNER_READINESS_VALUES).toEqual([
      'READY',
      'PARTIALLY_READY',
      'REQUIRES_CLARIFICATION',
    ]);
    expect(deriveProductOwnerReadiness([], [])).toBe('READY');
    expect(validateProductOwnerBusinessRules(specification)).toMatchObject({
      valid: true,
      expectedReadiness: 'READY',
    });
    expect(PRODUCT_OWNER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH).toContain(
      'READINESS_MISMATCH',
    );
    expect(PRODUCT_OWNER_AGENT_ERROR_CODES.RUN_FAILED).toBe('PRODUCT_OWNER_AGENT_RUN_FAILED');
  });

  it('exposes only the pure projection seam while keeping assembly, result and logging internal', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/product-owner-agent');

    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).toHaveProperty('projectProductOwnerPromptContexts');
    expect(publicApi).not.toHaveProperty('createProductOwnerAgentRunRequest');
    expect(publicApi).not.toHaveProperty('createGeneratedResult');
    expect(publicApi).not.toHaveProperty('requestLogContext');
    expect(publicApi).not.toHaveProperty('sanitizeProductOwnerSourceCode');
  });
});

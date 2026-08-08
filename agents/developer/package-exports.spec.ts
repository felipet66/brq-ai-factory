import {
  DEVELOPER_AGENT_ERROR_CODES,
  DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES,
  DEVELOPER_READINESS_VALUES,
  createDeveloperAgent,
  deriveDeveloperReadiness,
  developerAgentRequestSchema,
  developerAgentResultSchema,
  loadDeveloperPromptAssets,
  projectDeveloperPromptContexts,
  technicalSpecificationSchema,
  validateDeveloperBusinessRules,
  type DeveloperAgentRequest,
  type DeveloperAgentResult,
  type TechnicalSpecification,
} from '@brq/developer-agent';
import { describe, expect, it } from 'vitest';

import { createDeveloperRequest, createTechnicalSpecification } from './testing/developer-fixtures';

describe('@brq/developer-agent package exports', () => {
  it('exposes the facade, canonical contracts, schemas, assets and Business Validation API', () => {
    const request: DeveloperAgentRequest = createDeveloperRequest();
    const specification: TechnicalSpecification = createTechnicalSpecification();
    const resultTypeCheck: DeveloperAgentResult | undefined = undefined;

    expect(createDeveloperAgent).toBeTypeOf('function');
    expect(developerAgentRequestSchema.safeParse(request).success).toBe(true);
    expect(technicalSpecificationSchema.safeParse(specification).success).toBe(true);
    expect(developerAgentResultSchema).toBeDefined();
    expect(resultTypeCheck).toBeUndefined();
    expect(loadDeveloperPromptAssets().manifest.agent).toBe('DEVELOPER');
    expect(projectDeveloperPromptContexts).toBeTypeOf('function');
    expect(DEVELOPER_READINESS_VALUES).toEqual([
      'READY',
      'PARTIALLY_READY',
      'REQUIRES_CLARIFICATION',
    ]);
    expect(deriveDeveloperReadiness('READY', [], [])).toBe('READY');
    expect(
      validateDeveloperBusinessRules(specification, request.productOwnerSpecification),
    ).toMatchObject({ valid: true, expectedReadiness: 'READY' });
    expect(DEVELOPER_BUSINESS_VALIDATION_ISSUE_CODES.READINESS_MISMATCH).toContain(
      'READINESS_MISMATCH',
    );
    expect(DEVELOPER_AGENT_ERROR_CODES.RUN_FAILED).toBe('DEVELOPER_AGENT_RUN_FAILED');
  });

  it('exposes only the pure projection seam while keeping assembly, result and logging internal', async () => {
    const publicApi: Record<string, unknown> = await import('@brq/developer-agent');

    expect(publicApi).not.toHaveProperty('deepFreeze');
    expect(publicApi).toHaveProperty('projectDeveloperPromptContexts');
    expect(publicApi).not.toHaveProperty('createDeveloperAgentRunRequest');
    expect(publicApi).not.toHaveProperty('createGeneratedResult');
    expect(publicApi).not.toHaveProperty('requestLogContext');
    expect(publicApi).not.toHaveProperty('sanitizeDeveloperSourceCode');
  });
});
